#!/usr/bin/env node
/**
 * Phase 1 discovery: read the conference sheet exactly, per tab.
 *
 * The Drive connector's rendering is lossy — it concatenates tabs, drops
 * spacer-column headers, mangles non-ASCII and escapes error strings. This
 * reads the same workbook through Sheets' own gviz CSV endpoint from inside a
 * signed-in page, which returns exact cell values one tab at a time.
 *
 *   npm run sheet:probe            tab names, gids, headers, row counts
 *   npm run sheet:probe -- --save  also write each tab's full CSV to .data/
 *
 * .data/ is gitignored on purpose: this workbook carries employee emails,
 * costs and leave, which should not land in git.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { connectToChrome, requireHostTab } from "../shared/cdp.js";

// `page.evaluate` callbacks are serialized and run in the browser, not in Node,
// so browser globals are legitimate inside them only.
/* global document */

const GOOGLE_HOST_RE = /\.google\.com$/i;
const NAV_TIMEOUT_MS = 60000;
const OUT_DIR = ".data/sheet";

const hasFlag = (name) => process.argv.slice(2).includes(name);

/** Parse one CSV line, handling quotes and embedded commas/newlines-free case. */
export const parseCsvLine = (line) => {
  const out = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else inQ = false;
      } else cur += c;
      continue;
    }
    if (c === '"') {
      inQ = true;
      continue;
    }
    if (c === ",") {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out;
};

/**
 * Fetch a gviz CSV from inside the page, so the request carries the session
 * cookies. Two hard-won details:
 *
 *   - Select the tab by NAME (`sheet=`). The tab strip's `data-id` attribute is
 *     NOT the worksheet gid — it returns small ordinals (4, 41, 51) that look
 *     plausible but address nothing, and gviz answers a bad gid by returning
 *     the FIRST tab rather than an error. That reads as six successful reads of
 *     six tabs when it is one tab read six times. Hence the fingerprint guard
 *     below, and selection by name.
 *   - gviz needs a literal colon in `tqx=out:csv`, which URLSearchParams would
 *     percent-encode, so the query is built by hand.
 *
 * @param {string} range Optional A1 range. A single-row range (A1:ZZ1) is the
 *   reliable way to read a header row: over a whole column gviz infers a type
 *   from the data and drops a text header it cannot coerce, so date and number
 *   columns come back with a blank header.
 */
const fetchTabCsv = async (page, key, tabName, range) => {
  const url =
    `https://docs.google.com/spreadsheets/d/${key}/gviz/tq?tqx=out:csv` +
    `&headers=0&sheet=${encodeURIComponent(tabName)}` +
    (range ? `&range=${encodeURIComponent(range)}` : "");

  return page.evaluate(async (u) => {
    try {
      const r = await fetch(u, {
        credentials: "include",
        headers: { Accept: "text/csv" },
      });
      return { status: r.status, text: await r.text() };
    } catch (err) {
      return { status: 0, text: String(err) };
    }
  }, url);
};

/** Cheap content fingerprint, to catch "every tab came back the same". */
const fingerprint = (text) => {
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = (h * 31 + text.charCodeAt(i)) | 0;
  }
  return `${text.length}:${h}`;
};

/**
 * Read the worksheet tab strip: visible name plus gid per tab. Sheets renders
 * each tab with a `data-id` carrying the gid; fall back to the name alone if
 * that attribute ever moves.
 */
const readTabStrip = (page) =>
  page.evaluate(() => {
    const tabs = [...document.querySelectorAll(".docs-sheet-tab")];
    return tabs.map((el, index) => ({
      index,
      name: el.querySelector(".docs-sheet-tab-name")?.textContent?.trim() ?? "",
      gid: el.getAttribute("data-id") ?? el.id?.replace(/\D+/g, "") ?? "",
      active: el.classList.contains("docs-sheet-active-tab"),
    }));
  });

const main = async () => {
  const cfg = JSON.parse(await readFile("config/targets.json", "utf8"));
  const { key, url, pointedAtGid } = cfg.sheet;
  const save = hasFlag("--save");

  const browser = await connectToChrome();
  const { context } = requireHostTab(
    browser,
    GOOGLE_HOST_RE,
    "https://docs.google.com",
  );

  // Our own tab, so we never disturb one Ryan is using.
  const page = await context.newPage();
  try {
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: NAV_TIMEOUT_MS,
    });
    await page.waitForSelector("#docs-sheets-tab-bar, .docs-sheet-tab", {
      timeout: NAV_TIMEOUT_MS,
    });
    await page.waitForTimeout(1500);

    const tabs = await readTabStrip(page);
    console.log(`Workbook: ${key}`);
    console.log(`Tabs found: ${tabs.length}\n`);

    if (save) await mkdir(OUT_DIR, { recursive: true });

    let read = 0;
    const failures = [];
    const seen = new Map();

    for (const tab of tabs) {
      const marker =
        String(tab.gid) === String(pointedAtGid)
          ? "  <-- gid you pointed at"
          : "";
      console.log(
        `[${tab.index}] "${tab.name}"  gid=${tab.gid || "?"}${marker}`,
      );

      // Header row on its own, so gviz cannot type-infer it away.
      const head = await fetchTabCsv(page, key, tab.name, "A1:ZZ1");
      const body = await fetchTabCsv(page, key, tab.name);

      if (head.status !== 200 || body.status !== 200) {
        failures.push({
          tab: tab.name,
          why: `HTTP head=${head.status} body=${body.status}`,
        });
        console.log(
          `      FAILED — HTTP ${head.status}/${body.status}: ` +
            `${(head.text || body.text || "").slice(0, 160)}\n`,
        );
        continue;
      }

      const fp = fingerprint(body.text);
      const clash = seen.get(fp);
      if (clash !== undefined) {
        failures.push({
          tab: tab.name,
          why: `identical content to "${clash}" — tab selector is not working`,
        });
        console.log(
          `      SUSPECT — byte-identical to "${clash}". Treating as a failed\n` +
            `      read, not a real duplicate: a selector that silently returns\n` +
            `      the wrong tab would otherwise look like a success.\n`,
        );
        continue;
      }
      seen.set(fp, tab.name);
      read += 1;

      const header = parseCsvLine(head.text.split("\n")[0] ?? "");
      const lines = body.text.split("\n").filter((l) => l.length > 0);
      // "Non-empty" is not the same as "real". These tabs have formulas dragged
      // far past the data, emitting rows of N/N/N/FALSE forever — 1694 lines
      // for 112 actual requests. Count rows that carry an email instead.
      const withEmail = lines.filter((l) => l.includes("@")).length;
      console.log(
        `      lines=${lines.length}  cols=${header.length}  ` +
          `rows carrying an email=${withEmail}`,
      );
      console.log(
        "      header: " +
          header
            .map((h, i) => (h ? `[${i}] ${h}` : `[${i}] —`))
            .join(" · ")
            .slice(0, 2000),
      );

      if (save) {
        const slug =
          tab.name
            .replace(/[^a-z0-9]+/gi, "-")
            .replace(/^-|-$/g, "")
            .toLowerCase() || `tab-${tab.index}`;
        const out = join(OUT_DIR, `${tab.index}-${slug}.csv`);
        // Splice the good header over gviz's degraded one, so the saved file
        // stands on its own offline. Over a whole column gviz types the column
        // from its data and drops a text header it cannot coerce, so every
        // date and number column would otherwise have a blank name.
        const bodyLines = body.text.split("\n");
        bodyLines[0] = head.text.split("\n")[0] ?? bodyLines[0];
        await writeFile(out, bodyLines.join("\n"), "utf8");
        console.log(`      saved: ${out}`);
      }
      console.log("");
    }

    // Coverage, stated explicitly: a silent drop must not read as a real zero,
    // and neither must the same tab counted six times.
    console.log(
      `Read ${read} of ${tabs.length} tabs as distinct content; ` +
        `${failures.length} failed or suspect.`,
    );
    for (const f of failures) console.log(`  FAILED  ${f.tab}: ${f.why}`);
    if (failures.length > 0) process.exitCode = 1;
  } finally {
    await page.close();
    // Playwright's connectOverCDP holds the Node event loop open until the
    // connection is dropped, so without this the run writes every CSV and then
    // hangs forever rather than exiting. Over CDP this disconnects the client;
    // it does not close Ryan's Chrome or any tab he has open.
    await browser.close();
  }
};

main().catch((err) => {
  console.error(err.message ?? err);
  process.exitCode = 1;
});
