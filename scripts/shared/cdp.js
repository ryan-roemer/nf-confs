/**
 * Shared Chrome DevTools Protocol (CDP) helpers for the conference pipeline.
 *
 * Every script here drives ONE long-running debug Chrome that Ryan signs into
 * by hand — Google (for the conference sheet) and Notion (for the events hub).
 * That Chrome is deliberately NOT the everyday Chrome on port 9222:
 *
 *   - Chrome only enables --remote-debugging-port on a fresh process per
 *     user-data-dir, so a separate profile is the only way to have both.
 *   - Automation that can read and write a Notion workspace should not be
 *     pointed at a browser full of unrelated signed-in tabs.
 *
 * Hence a dedicated profile dir and a dedicated port. Override the port with
 * NF_CONFS_CDP_PORT if 9333 is ever taken.
 */

import { chromium } from "playwright";
import { homedir } from "node:os";
import { join } from "node:path";

/** Debug port for the conference Chrome. Not 9222 — that's the everyday one. */
export const CDP_PORT = Number(process.env.NF_CONFS_CDP_PORT) || 9333;

export const CDP_ENDPOINT = `http://127.0.0.1:${CDP_PORT}`;

/** Playwright's connect budget, made explicit so the error text can cite it. */
export const CDP_CONNECT_TIMEOUT_MS = 30000;

/**
 * Page/worker count above which the attach sweep starts eating the connect
 * budget. A healthy run needs two or three tabs, so anything past a dozen is
 * stray tabs, not us.
 */
export const TARGET_WARN_THRESHOLD = 12;

/** Attachable target types — the ones Playwright waits on during connect. */
const ATTACHABLE_TYPES = new Set([
  "page",
  "worker",
  "service_worker",
  "iframe",
]);

/**
 * Dedicated Chrome profile dir. First run: empty profile, and Ryan signs into
 * Google and Notion once in the new window. Cookies persist across runs.
 * @returns {string}
 */
export const getProfileDir = () =>
  join(homedir(), ".nf-confs", "chrome-profile");

/**
 * OS-specific command to launch Chrome with remote debugging and the
 * dedicated user-data-dir.
 * @returns {string}
 */
export const getChromeCommand = () => {
  const profileDir = getProfileDir();
  const flags =
    `--remote-debugging-port=${CDP_PORT} ` +
    `--user-data-dir="${profileDir}" ` +
    // No session restore: a relaunch always comes back with zero stray tabs,
    // which is the documented fix for a blown connect budget below.
    `--no-first-run --no-default-browser-check`;

  if (process.platform === "darwin") {
    return `/Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome ${flags}`;
  }
  if (process.platform === "win32") {
    return `"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" ${flags}`;
  }
  return `google-chrome ${flags}`;
};

/**
 * Read the CDP target list over plain HTTP. Deliberately independent of
 * Playwright: this is what tells us the endpoint is alive even when
 * connectOverCDP is timing out.
 * @param {number} timeoutMs
 * @returns {Promise<Array<{type: string, url: string, title: string}>|null>}
 *   null when the endpoint is unreachable.
 */
export const fetchTargets = async (timeoutMs = 3000) => {
  try {
    const res = await fetch(`${CDP_ENDPOINT}/json/list`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const targets = await res.json();
    return Array.isArray(targets) ? targets : null;
  } catch {
    return null;
  }
};

/**
 * Read the browser version banner. Distinguishes "port is live" from "port is
 * live and it is actually Chrome".
 * @returns {Promise<object|null>}
 */
export const fetchVersion = async (timeoutMs = 3000) => {
  try {
    const res = await fetch(`${CDP_ENDPOINT}/json/version`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
};

/**
 * Open a blank tab via the HTTP endpoint (PUT since Chrome 111). Used to
 * recover a Chrome whose last window was closed — see `ensureWindow`.
 * @returns {Promise<boolean>} true when a tab was created.
 */
export const openBlankTab = (timeoutMs = 5000) =>
  openTab("about:blank", timeoutMs);

/**
 * Open a tab at a URL via the HTTP endpoint (PUT since Chrome 111).
 * @param {string} url
 * @returns {Promise<boolean>}
 */
export const openTab = async (url, timeoutMs = 10000) => {
  try {
    const res = await fetch(
      `${CDP_ENDPOINT}/json/new?${encodeURIComponent(url)}`,
      { method: "PUT", signal: AbortSignal.timeout(timeoutMs) },
    );
    return res.ok;
  } catch {
    return false;
  }
};

/**
 * Poll until the debug port answers, for use right after spawning Chrome.
 * @returns {Promise<object|null>} the version banner, or null on timeout.
 */
export const waitForPort = async (timeoutMs = 20000, intervalMs = 250) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const version = await fetchVersion(1000);
    if (version) return version;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return null;
};

/**
 * Recover the "Chrome is running but has no windows" state.
 *
 * Closing the last tab does NOT quit a Chrome that has remote debugging
 * enabled: the process stays alive, /json/version keeps answering, and
 * /json/list drops to zero targets. Playwright then fails at connect time with
 * `Protocol error (Browser.setDownloadBehavior): Browser context management is
 * not supported` — a message that names neither the cause nor the fix. Verified
 * by closing the last page target on a scratch profile and reproducing it.
 *
 * Opening a blank tab restores it, so heal rather than sending the user off to
 * click. This is our own dedicated profile, so an extra blank tab is harmless.
 *
 * @returns {Promise<"ok"|"healed"|"dead"|"unhealed">}
 */
export const ensureWindow = async () => {
  if (!(await fetchVersion())) return "dead";
  const targets = await fetchTargets();
  if (targets && targets.length > 0) return "ok";
  if (!(await openBlankTab())) return "unhealed";
  const after = await fetchTargets();
  return after && after.length > 0 ? "healed" : "unhealed";
};

/**
 * Summarize a target list into the counts the diagnostics care about.
 * @param {Array<{type: string, url: string}>} targets
 */
export const summarizeTargets = (targets) => {
  const byType = {};
  for (const { type } of targets) byType[type] = (byType[type] || 0) + 1;
  const attachable = targets.filter((t) => ATTACHABLE_TYPES.has(t.type));
  const hosts = {};
  for (const { url } of attachable) {
    let host = "other";
    try {
      host = new URL(url).host || url.split(":")[0];
    } catch {
      host = "other";
    }
    hosts[host] = (hosts[host] || 0) + 1;
  }
  const topHosts = Object.entries(hosts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  return { byType, attachable: attachable.length, hosts, topHosts };
};

/**
 * Error text for "the port answers, but Playwright still could not attach".
 * The failure mode is misleading — the websocket connects, then Playwright
 * auto-attaches to EVERY target and waits for each to initialize, so a debug
 * Chrome that has accumulated unrelated tabs blows the connect budget before
 * any of our code runs. Telling the user to "start Chrome" here would send
 * them chasing the wrong thing.
 * @param {Array<{type: string, url: string}>} targets
 * @param {string} underlying
 * @returns {string}
 */
const overloadedTargetsMessage = (targets, underlying) => {
  const { byType, attachable, topHosts } = summarizeTargets(targets);
  const types = Object.entries(byType)
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => `${count} ${type}`)
    .join(", ");
  const hostLines = topHosts.map(([host, count]) => `    ${count}x ${host}`);

  return (
    `Chrome at ${CDP_ENDPOINT} is running and reachable, but Playwright could ` +
    `not attach within ${CDP_CONNECT_TIMEOUT_MS}ms.\n` +
    `\n` +
    `This is almost always too many open targets, NOT a stopped Chrome.\n` +
    `connectOverCDP auto-attaches to every target and waits for each one, so\n` +
    `stray tabs exhaust the connect budget before the pipeline starts.\n` +
    `\n` +
    `Currently ${targets.length} targets (${types}); ${attachable} attachable.\n` +
    (hostLines.length ? `  Busiest origins:\n${hostLines.join("\n")}\n` : "") +
    `\n` +
    `Fix: close the unrelated tabs, or quit and relaunch this Chrome — the\n` +
    `profile has no session restore, so it comes back clean:\n` +
    `  npm run chrome:run\n` +
    `\n` +
    `Inspect what is open:\n` +
    `  npm run chrome:status\n` +
    `\n` +
    `Profile dir: ${getProfileDir()}\n` +
    `Underlying error: ${underlying}`
  );
};

/**
 * Error text for "the port answers but Chrome has no windows left". Distinct
 * from both other failures and the one most likely to happen in normal use:
 * close the last tab and the next run breaks with an error about download
 * behaviour. See `ensureWindow` for the mechanism.
 * @param {string} underlying
 * @returns {string}
 */
const noWindowsMessage = (underlying) =>
  `Chrome at ${CDP_ENDPOINT} is running, but it has no windows or tabs open,\n` +
  `and Playwright cannot attach to a window-less browser.\n` +
  `\n` +
  `Closing the last tab does not quit a Chrome with remote debugging on — the\n` +
  `process survives and keeps answering on the port, so this looks like a\n` +
  `connection problem when it is really an empty browser.\n` +
  `\n` +
  `Auto-recovery (opening a blank tab) was attempted and did not take.\n` +
  `\n` +
  `Fix: open any tab in that Chrome window, or quit and relaunch it:\n` +
  `  npm run chrome:run\n` +
  `\n` +
  `Profile dir: ${getProfileDir()}\n` +
  `Underlying error: ${underlying}`;

/**
 * Error text for "nothing is listening on the debug port".
 * @param {string} underlying
 * @returns {string}
 */
const notRunningMessage = (underlying) =>
  `Could not connect to Chrome at ${CDP_ENDPOINT}.\n` +
  `\n` +
  `Start the conference Chrome first (leaves your everyday Chrome on 9222\n` +
  `alone):\n` +
  `  npm run chrome:run\n` +
  `\n` +
  `Then check what it is signed into:\n` +
  `  npm run chrome:status\n` +
  `\n` +
  `Profile dir: ${getProfileDir()}\n` +
  `Underlying error: ${underlying}`;

/**
 * Connect to the conference Chrome. Warns up front when the browser has
 * collected enough targets to threaten the connect budget, and on failure
 * distinguishes "Chrome is not running" from "Chrome is running but
 * overloaded" — the two have very different fixes and identical-looking
 * Playwright errors.
 * @returns {Promise<import("playwright").Browser>}
 */
export const connectToChrome = async () => {
  // Heal the window-less state before spending the connect budget on it.
  const window = await ensureWindow();
  if (window === "healed") {
    console.warn(
      "Note: conference Chrome had no tabs open (closing the last tab does " +
        "not quit it). Opened a blank tab to make it attachable.",
    );
  }

  const preflight = await fetchTargets();
  if (preflight && preflight.length > TARGET_WARN_THRESHOLD) {
    const { attachable } = summarizeTargets(preflight);
    console.warn(
      `Warning: conference Chrome has ${preflight.length} open targets ` +
        `(${attachable} attachable). Attaching may be slow or time out — ` +
        `close unrelated tabs if this run stalls.`,
    );
  }

  try {
    return await chromium.connectOverCDP(CDP_ENDPOINT, {
      timeout: CDP_CONNECT_TIMEOUT_MS,
    });
  } catch (err) {
    // Three failures look alike from Playwright's error but need different
    // fixes, so name them apart rather than guessing at the most common.
    const version = await fetchVersion();
    if (!version) throw new Error(notRunningMessage(err.message));

    const targets = await fetchTargets();
    if (!targets || targets.length === 0) {
      throw new Error(noWindowsMessage(err.message));
    }
    if (targets.length > TARGET_WARN_THRESHOLD) {
      throw new Error(overloadedTargetsMessage(targets, err.message));
    }
    throw new Error(
      `Chrome at ${CDP_ENDPOINT} is running with ${targets.length} targets ` +
        `open, but Playwright could not attach within ` +
        `${CDP_CONNECT_TIMEOUT_MS}ms — and this is not one of the known\n` +
        `failure modes (not running / no windows / too many tabs).\n` +
        `\n` +
        `Relaunching usually clears it:\n` +
        `  npm run chrome:run\n` +
        `\n` +
        `Profile dir: ${getProfileDir()}\n` +
        `Underlying error: ${err.message}`,
    );
  }
};

/**
 * Guard against attaching to the wrong Chrome: refuse to proceed unless the
 * connected browser has a tab on each host the caller needs. Signing in is
 * manual and one-off, so a clear failure here is worth more than a mystery
 * timeout deep in a scrape.
 * @param {import("playwright").Browser} browser
 * @param {RegExp} hostRe Host pattern the caller requires, e.g. /\.notion\.so$/
 * @param {string} openUrl URL to tell the user to open when nothing matches.
 * @returns {{context: import("playwright").BrowserContext, pages: import("playwright").Page[]}}
 */
export const requireHostTab = (browser, hostRe, openUrl) => {
  const contexts = browser.contexts();
  if (contexts.length === 0) {
    throw new Error(`No browser contexts found over CDP at ${CDP_ENDPOINT}.`);
  }
  const context = contexts[0];
  const pages = context.pages().filter((p) => {
    try {
      return hostRe.test(new URL(p.url()).hostname);
    } catch {
      return false;
    }
  });
  if (pages.length === 0) {
    throw new Error(
      `No tab matching ${hostRe} found in the conference Chrome.\n` +
        `Open ${openUrl} in that window and sign in, then rerun.\n` +
        `Profile dir: ${getProfileDir()}`,
    );
  }
  return { context, pages };
};

/**
 * ONE page, chosen by what it actually holds — use this instead of taking
 * `requireHostTab(...).pages[0]`.
 *
 * **Why this exists.** Ryan's conference Chrome runs a dozen-plus tabs, and a
 * host match is not a document match: `docs.google.com` matches Docs, Sheets
 * and Drive alike. On 2026-09-03 `pages[0]` handed back a Google **Docs** tab
 * for a spreadsheet read, and the in-page `fetch` then failed with a bare
 * `TypeError: Failed to fetch` — a symptom that looks like a network or auth
 * problem and is really "wrong tab". `pickTarget` in `cdp-eval.js` avoids this
 * by preferring `/spreadsheets/d/`; this is the same idea for Playwright pages,
 * and it **throws rather than guessing** when the match is not unique.
 *
 * Three other CDP footguns, all hit the same day, none of them Chrome's fault:
 *
 *  - **Never `await response.text()` inside a `page.on("response")` handler
 *    while navigating.** It stalls the navigation and surfaces as a `goto`
 *    timeout. Collect the URLs during load and re-fetch in-page afterwards.
 *  - **Never guess a selector on a heavy SPA.** Query for it, log what came
 *    back, and only then act. Notion renders no plain `input[type=search]`.
 *  - **A scroll loop must prove it scrolled.** Check `scrollTop` moved or the
 *    row count grew before iterating; otherwise you scroll the sidebar sixty
 *    times and report a confident zero.
 *
 * @param {import("playwright").Browser} browser
 * @param {{hostRe: RegExp, urlIncludes?: string, what: string}} spec
 *   `urlIncludes` is matched against the full URL, e.g. `"/spreadsheets/d/"` or
 *   a document key. `what` names the thing, for the error message.
 * @returns {import("playwright").Page}
 */
export const requirePage = (browser, { hostRe, urlIncludes, what }) => {
  const { pages } = requireHostTab(browser, hostRe, `a ${what} tab`);
  const matches = urlIncludes
    ? pages.filter((p) => p.url().includes(urlIncludes))
    : pages;

  const listing = () =>
    pages.map((p, i) => `    [${i}] ${p.url().slice(0, 110)}`).join("\n");

  if (matches.length === 0) {
    throw new Error(
      `No tab is showing ${what}` +
        `${urlIncludes ? ` (URL must contain ${JSON.stringify(urlIncludes)})` : ""}.\n` +
        `  ${pages.length} tab(s) matched the host but none the document:\n` +
        `${listing()}\n` +
        `  Open ${what} in the conference Chrome, then rerun.`,
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `${matches.length} tabs are showing ${what} — refusing to pick one, ` +
        `because driving the wrong\n  tab in Ryan's browser is exactly the ` +
        `failure this guard exists for:\n${listing()}\n` +
        `  Close the duplicates, or narrow urlIncludes.`,
    );
  }
  return matches[0];
};
