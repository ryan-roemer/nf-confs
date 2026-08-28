#!/usr/bin/env node
/**
 * Manage the dedicated conference Chrome — the one signed into Google (the
 * conference sheet) and Notion (the events hub).
 *
 *   npm run chrome           print the launch command, don't run it
 *   npm run chrome:run       spawn it detached
 *   npm run chrome:login     spawn if needed, then open the sign-in tabs
 *   npm run chrome:status    what's listening, what's open, what's signed in
 */

import { spawn } from "node:child_process";

import {
  CDP_ENDPOINT,
  CDP_PORT,
  ensureWindow,
  fetchTargets,
  fetchVersion,
  getChromeCommand,
  getProfileDir,
  openTab,
  summarizeTargets,
  TARGET_WARN_THRESHOLD,
  waitForPort,
} from "./shared/cdp.js";

const args = process.argv.slice(2);
const hasFlag = (name) => args.includes(name);

/** Hosts the pipeline needs a signed-in tab on, and where to get one. */
const REQUIRED_HOSTS = [
  {
    label: "Google Sheets",
    re: /\.google\.com$/i,
    open: "https://docs.google.com",
  },
  {
    label: "Notion",
    re: /(^|\.)notion\.so$|(^|\.)notion\.com$/i,
    open: "https://www.notion.so",
  },
];

/** Print the command without running it. */
const printCommand = () => {
  console.log(
    "Conference Chrome — a separate profile you sign into by hand.\n",
  );
  console.log(`Port:        ${CDP_PORT} (your everyday Chrome keeps 9222)`);
  console.log(`Profile dir: ${getProfileDir()}\n`);
  console.log("Copy/paste this into a terminal:\n");
  console.log(`  ${getChromeCommand()}\n`);
  console.log("Or spawn it now, detached:\n");
  console.log("  npm run chrome:run\n");
  console.log("First run, in the new window, sign into:");
  for (const { label, open } of REQUIRED_HOSTS) {
    console.log(`  ${label.padEnd(14)} ${open}`);
  }
  console.log("\nCookies persist in the profile dir, so this is a one-off.");
  console.log("\nThen check it:\n");
  console.log("  npm run chrome:status");
};

/** Spawn Chrome detached so the CLI returns immediately. */
const run = async () => {
  const existing = await fetchVersion();
  if (existing) {
    console.log(
      `Chrome is already listening on ${CDP_ENDPOINT} ` +
        `(${existing.Browser ?? "unknown build"}).`,
    );
    // A running-but-window-less Chrome is not "nothing to do" — it is the
    // state Playwright cannot attach to. Fix it here.
    const window = await ensureWindow();
    if (window === "healed") {
      console.log(
        "\nIt had no tabs open, which makes it unattachable. Opened a blank " +
          "tab.",
      );
    } else if (window === "unhealed") {
      console.log(
        "\nWarning: it has no tabs open and would not accept a new one. " +
          "Quit that Chrome window and rerun this command.",
      );
      process.exitCode = 1;
      return;
    }
    console.log("\nTo inspect it:\n");
    console.log("  npm run chrome:status");
    return;
  }

  const child = spawn("sh", ["-c", getChromeCommand()], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();

  console.log(
    `Conference Chrome spawned on port ${CDP_PORT} (pid ${child.pid}).`,
  );
  console.log(`Profile dir: ${getProfileDir()}\n`);
  console.log("If this is the first run, sign into these in the new window:");
  for (const { label, open } of REQUIRED_HOSTS) {
    console.log(`  ${label.padEnd(14)} ${open}`);
  }
  console.log("\nThen verify:\n");
  console.log("  npm run chrome:status");
};

/**
 * login - get Ryan to a window he can sign into, in one command. Spawns Chrome
 * if it isn't up, waits for the port, then opens a tab per required host,
 * skipping hosts that already have one.
 */
const login = async () => {
  let version = await fetchVersion();

  if (!version) {
    const child = spawn("sh", ["-c", getChromeCommand()], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    console.log(
      `Spawned conference Chrome on port ${CDP_PORT} (pid ${child.pid}).`,
    );
    version = await waitForPort();
    if (!version) {
      console.error(
        `\nChrome did not start answering on ${CDP_ENDPOINT} in time.\n` +
          `Try the command by hand:\n\n  ${getChromeCommand()}`,
      );
      process.exitCode = 1;
      return;
    }
  } else {
    console.log(
      `Conference Chrome already up (${version.Browser ?? "unknown build"}).`,
    );
    await ensureWindow();
  }

  const targets = (await fetchTargets()) ?? [];
  const openHosts = new Set(
    targets.map((t) => {
      try {
        return new URL(t.url).hostname;
      } catch {
        return "";
      }
    }),
  );

  console.log("");
  let opened = 0;
  for (const { label, re, open } of REQUIRED_HOSTS) {
    if ([...openHosts].some((h) => re.test(h))) {
      console.log(`  already open   ${label.padEnd(14)} — skipped`);
      continue;
    }
    const ok = await openTab(open);
    opened += ok ? 1 : 0;
    console.log(
      `  ${ok ? "opened" : "FAILED"}${ok ? "         " : "         "}${label.padEnd(14)} — ${open}`,
    );
  }

  console.log(
    `\nOpened ${opened} of ${REQUIRED_HOSTS.length} required hosts ` +
      `(${REQUIRED_HOSTS.length - opened} already had a tab).`,
  );
  console.log(
    "\nSign in to each in that window — it is the theme-coloured Chrome, not\n" +
      "your everyday one. Cookies persist in the profile, so this is a one-off.",
  );
  console.log("\nWhen done:\n");
  console.log("  npm run chrome:status");
};

/**
 * Report the endpoint, the open targets, and — the part that actually matters
 * before a run — whether a tab exists for each host we need. Reports coverage
 * explicitly: a host with no tab is called out, not silently omitted.
 */
const status = async () => {
  const version = await fetchVersion();
  console.log("Conference Chrome status");
  console.log("========================\n");
  console.log(`Endpoint:    ${CDP_ENDPOINT}`);
  console.log(`Profile dir: ${getProfileDir()}\n`);

  if (!version) {
    console.log("Listening:   NO — nothing answered on the debug port.\n");
    console.log("Start it:\n");
    console.log("  npm run chrome:run");
    process.exitCode = 1;
    return;
  }

  console.log(`Listening:   yes — ${version.Browser ?? "unknown build"}`);

  const targets = await fetchTargets();
  if (!targets) {
    console.log(
      "\nThe version endpoint answered but the target list did not. " +
        "Chrome may be mid-shutdown; retry in a moment.",
    );
    process.exitCode = 1;
    return;
  }

  if (targets.length === 0) {
    console.log(
      "Targets:     0 — Chrome is running with no windows or tabs.\n",
    );
    console.log(
      "Playwright cannot attach to a window-less browser, and closing the\n" +
        "last tab does not quit a Chrome with remote debugging on — so this\n" +
        "state looks like a dead port but is not one.\n",
    );
    console.log("Fix: open any tab in that window, or:\n");
    console.log("  npm run chrome:run   (heals it in place)");
    process.exitCode = 1;
    return;
  }

  const { byType, attachable, hosts } = summarizeTargets(targets);
  const types = Object.entries(byType)
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => `${count} ${type}`)
    .join(", ");
  console.log(
    `Targets:     ${targets.length} (${types}); ${attachable} attachable`,
  );
  if (targets.length > TARGET_WARN_THRESHOLD) {
    console.log(
      `             ^ above the ${TARGET_WARN_THRESHOLD}-target warn ` +
        `threshold; attaching may be slow. Close stray tabs.`,
    );
  }

  console.log("\nOpen origins:");
  const hostEntries = Object.entries(hosts).sort((a, b) => b[1] - a[1]);
  if (hostEntries.length === 0) {
    console.log("  (none)");
  } else {
    for (const [host, count] of hostEntries) {
      console.log(`  ${String(count).padStart(3)}x ${host}`);
    }
  }

  console.log("\nHosts this pipeline needs a tab on:");
  let missing = 0;
  for (const { label, re, open } of REQUIRED_HOSTS) {
    const match = hostEntries.filter(([host]) => re.test(host));
    if (match.length === 0) {
      missing += 1;
      console.log(`  MISSING  ${label.padEnd(14)} — open ${open} and sign in`);
    } else {
      const where = match.map(([host]) => host).join(", ");
      console.log(`  ok       ${label.padEnd(14)} — ${where}`);
    }
  }
  console.log(
    `\nChecked ${REQUIRED_HOSTS.length} required hosts; ` +
      `${REQUIRED_HOSTS.length - missing} present, ${missing} missing.`,
  );
  console.log(
    "\nNote: a tab on the host proves the tab, not the login. A signed-out " +
      "\nNotion tab looks identical here — the first real read will say so.",
  );
  if (missing > 0) process.exitCode = 1;
};

const main = async () => {
  if (hasFlag("--status")) return status();
  if (hasFlag("--login")) return login();
  if (hasFlag("--run")) return run();
  return printCommand();
};

main().catch((err) => {
  console.error(err.message ?? err);
  process.exitCode = 1;
});
