#!/usr/bin/env node
/**
 * Match the pending queue against candidate Events Calendar pages and print a
 * plan. Read-only and deterministic: it decides update-vs-create, and refuses
 * to guess when two pages look equally likely.
 *
 *   npm run notion:match           the plan, human-readable
 *   npm run notion:match -- --json machine-readable, for the skill
 *
 * Inputs:
 *   .data/sheet/*.csv            from `npm run sheet:probe -- --save`
 *   .data/notion/candidates.json from the skill (only MCP can read Notion)
 *
 * candidates.json shape: { fetchedAt, query, pages: [ { url, Name, Link,
 *   d_start, d_end, etype, Status, Engagement, Who, Location, Region,
 *   Affliation, Organiser, Audience, Tags, "CFP Details" } ] }
 */

import { readFile } from "node:fs/promises";

import { loadRecords, queueOf } from "../sheet/lib/records.js";
import { classify, parseList } from "./lib/match.js";

const CANDIDATES = ".data/notion/candidates.json";
const hasFlag = (n) => process.argv.slice(2).includes(n);

const loadCandidates = async () => {
  try {
    const parsed = JSON.parse(await readFile(CANDIDATES, "utf8"));
    if (!Array.isArray(parsed.pages)) {
      throw new Error(`${CANDIDATES} has no "pages" array.`);
    }
    return parsed;
  } catch (err) {
    if (err.code === "ENOENT") {
      throw new Error(
        `${CANDIDATES} not found.\n\n` +
          `Only a Claude session can read Notion, so the skill fetches\n` +
          `candidate pages and writes them here first. See\n` +
          `.claude/skills/conf-process/SKILL.md, step "Fetch Notion candidates".`,
      );
    }
    throw err;
  }
};

const short = (s, n) =>
  s && s.length > n ? `${s.slice(0, n - 1)}…` : (s ?? "");

const printPage = (c, indent = "      ") => {
  const p = c.page;
  const status = parseList(p.Status).join("/") || "—";
  const who = parseList(p.Who).length;
  console.log(
    `${indent}score ${String(c.score).padStart(3)}  ${short(p.Name, 40).padEnd(40)} ` +
      `${(p.d_start ?? "—").padEnd(10)}  ${status.padEnd(24)} who=${who}`,
  );
  console.log(`${indent}      ${c.signals.join(", ") || "no signals"}`);
  console.log(`${indent}      ${short(p.Link, 90) || "(no link)"}`);
};

const main = async () => {
  const { records, warnings } = await loadRecords();
  for (const w of warnings) console.warn(`Warning: ${w}\n`);

  const cand = await loadCandidates();
  const queue = queueOf(records);

  const plan = queue.map((r) => ({
    record: r,
    result: classify(r, cand.pages),
  }));

  if (hasFlag("--json")) {
    console.log(JSON.stringify({ fetchedAt: cand.fetchedAt, plan }, null, 2));
    return;
  }

  console.log("Match plan");
  console.log("==========");
  console.log(
    `Queue: ${queue.length} record(s).  Candidates: ${cand.pages.length} ` +
      `page(s) fetched ${cand.fetchedAt ?? "at an unrecorded time"}.\n`,
  );

  for (const { record: r, result } of plan) {
    console.log(
      `\n${result.verdict.toUpperCase()}  row ${r.sheetRow}  ${r.name}  (${r.date.iso ?? "no date"})`,
    );
    console.log(`  ${result.why}`);
    console.log(`  sheet url: ${short(r.website, 90) || "(none)"}`);

    if (result.best) {
      console.log("  target page:");
      printPage(result.best);
    }
    if (result.verdict === "ambiguous") {
      console.log("  competing pages — YOUR CALL:");
      for (const c of result.candidates) printPage(c);
    }
    if (result.priorYears.length > 0) {
      console.log(
        `  same series, other years (${result.priorYears.length}) — useful as a template:`,
      );
      for (const c of result.priorYears.slice(0, 4)) printPage(c);
    }
    if (
      result.verdict === "create" &&
      result.priorYears.length === 0 &&
      result.candidates.length > 0
    ) {
      const near = result.candidates.filter((c) => c.score > 0).slice(0, 3);
      if (near.length) {
        console.log("  nearest non-matches, for your sanity check:");
        for (const c of near) printPage(c);
      }
    }
  }

  // Coverage. A quiet plan and a broken input must never look alike.
  const count = (v) => plan.filter((p) => p.result.verdict === v).length;
  console.log(
    `\n\nPlanned ${plan.length} of ${queue.length} queued record(s):`,
  );
  console.log(`  update        ${count("update")}`);
  console.log(`  create        ${count("create")}`);
  console.log(`  ambiguous     ${count("ambiguous")}   <- needs your decision`);
  console.log(
    `  needs-review  ${count("needs-review")}   <- needs your decision`,
  );

  const asks = count("ambiguous") + count("needs-review");
  if (asks > 0) {
    console.log(
      `\n${asks} record(s) cannot be decided deterministically. Do not guess — ` +
        `ask Ryan, then log the decision (see docs/decisions.md).`,
    );
  }
};

main().catch((err) => {
  console.error(err.message ?? err);
  process.exitCode = 1;
});
