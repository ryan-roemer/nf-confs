#!/usr/bin/env node
/**
 * Stage 1 of the workflow: triage `Form Responses 1` and report what is waiting
 * on Ryan. Purely deterministic — reads the saved CSVs, decides nothing that
 * needs judgment, and never writes anywhere.
 *
 *   npm run sheet:pending           the queue, with each ask summarised
 *   npm run sheet:pending -- --all  every speaking row, processed or not
 *   npm run sheet:pending -- --json machine-readable, for the skill to consume
 *
 * Reads .data/sheet/, so run `npm run sheet:probe -- --save` first.
 * See docs/workflow.md for what each field means and docs/schema.md for why the
 * parsing looks the way it does.
 */

import { FORM_CSV, loadRecords, queueOf } from "./lib/records.js";

const args = process.argv.slice(2);
const hasFlag = (n) => args.includes(n);

const money = (c) => {
  if (c.empty) return "\u2014";
  if (c.declined) return `${c.raw}  \u2192 treated as 0 (${c.why})`;
  if (c.needsRyan) return `${c.raw}  \u26a0\ufe0f ${c.why}`;
  return `${c.raw}${c.assumedEur ? "  (EUR assumed \u2014 no symbol given)" : ""}`;
};

const printRecord = (r) => {
  const dateStr = r.date.iso
    ? `${r.date.iso}${r.date.endIso ? ` \u2192 ${r.date.endIso}` : ""}` +
      (r.date.ambiguous ? "  \u26a0\ufe0f AMBIGUOUS day/month" : "")
    : `\u26a0\ufe0f unparsed (${r.date.raw || "empty"}${r.date.why ? `: ${r.date.why}` : ""})`;

  console.log(`\n  row ${r.sheetRow}  ${r.name}`);
  console.log(`    ${r.email}`);
  console.log(
    `    date       ${dateStr}   duration=${r.date.duration || "\u2014"}`,
  );
  console.log(`    website    ${r.website || "\u26a0\ufe0f none"}`);
  console.log(`    location   ${r.location || "\u2014"}`);
  if (!r.needsBudget) {
    console.log(
      // State the fact the decision was actually made on. `needsBudget` reads
      // the three ask columns, NOT the engagement variant, so naming the
      // variant here would mis-attribute a plain "Speak\u2026" row that happens to
      // ask for nothing.
      `    ask        none \u2014 leave, travel and hotel all "no"`,
    );
  } else {
    console.log(
      `    ask        leave=${r.ask.leave ? "YES" : "no"}  ` +
        `travel=${r.ask.travel ? "YES" : "no"}  hotel=${r.ask.hotel ? "YES" : "no"}`,
    );
    console.log(`    travel     ${money(r.ask.travelCost)}`);
    console.log(`    hotel      ${money(r.ask.hotelCost)}`);
    console.log(
      `    total      ${r.ask.total ?? "\u2014"}` +
        `${r.ask.total === null ? "  \u26a0\ufe0f incomplete, see above" : ""}`,
    );
  }
  console.log(
    `    marks      Speaking=${r.marks.speaking} ` +
      `Email/Slack Sent=${r.marks.emailSlackSent} Funded=${r.marks.funded || "\u2014"}`,
  );
  console.log(
    `    triage     ${r.triage.state.toUpperCase()} \u2014 ${r.triage.why}`,
  );
};

const main = async () => {
  const { records, warnings } = await loadRecords();
  for (const w of warnings) console.warn(`Warning: ${w}\n`);

  if (hasFlag("--json")) {
    console.log(
      JSON.stringify(hasFlag("--all") ? records : queueOf(records), null, 2),
    );
    return;
  }

  const show = hasFlag("--all")
    ? records.filter((r) => r.isSpeaking)
    : queueOf(records);

  console.log("Speaking entries awaiting you");
  console.log("=============================");
  for (const r of show) printRecord(r);

  // Coverage, always. A quiet queue and a broken read must not look alike.
  const count = (s) => records.filter((r) => r.triage.state === s).length;
  console.log(`\n\nRead ${records.length} data rows from ${FORM_CSV}.`);
  console.log(
    `  speaking engagements   ${records.filter((r) => r.isSpeaking).length}` +
      ` (${records.filter((r) => r.needsBudget).length} with a budget ask, ` +
      `${records.filter((r) => r.isSpeaking && !r.needsBudget).length} without)`,
  );
  console.log(`  pending                ${count("pending")}`);
  console.log(
    `  done (Speaking ticked)  ${count("done")}` +
      `   of which awaiting your Email/Slack Sent: ` +
      `${records.filter((r) => r.triage.state === "done" && !r.marks.emailSlackSent).length}`,
  );
  console.log(`  not speaking (skipped) ${count("skip")}`);
  console.log(
    `\nShowing ${show.length}. Use --all for every speaking row, --json for the full data.`,
  );

  const flags = [];
  for (const r of records) {
    if (r.triage.state === "skip" || r.triage.state === "done") continue;
    if (r.date.ambiguous)
      flags.push(`row ${r.sheetRow}: ambiguous date ${r.date.raw}`);
    if (!r.date.iso)
      flags.push(`row ${r.sheetRow}: unparsed date ${r.date.raw || "(empty)"}`);
    if (!r.website)
      flags.push(
        `row ${r.sheetRow}: no Event website \u2014 URL matching impossible`,
      );
    if (r.ask.travelCost.needsRyan)
      flags.push(
        `row ${r.sheetRow}: travel cost ${r.ask.travelCost.why} \u2014 ${r.ask.travelCost.raw}`,
      );
    if (r.ask.hotelCost.needsRyan)
      flags.push(
        `row ${r.sheetRow}: hotel cost ${r.ask.hotelCost.why} \u2014 ${r.ask.hotelCost.raw}`,
      );
    if (r.ask.travel && r.ask.travelCost.empty)
      flags.push(`row ${r.sheetRow}: travel requested but no estimate given`);
    if (r.ask.hotel && r.ask.hotelCost.empty)
      flags.push(`row ${r.sheetRow}: hotel requested but no estimate given`);
    if (!r.needsBudget && (r.ask.leave || r.ask.travel || r.ask.hotel))
      flags.push(
        `row ${r.sheetRow}: says "without requesting support" but asks for something`,
      );
  }
  if (flags.length) {
    console.log(`\nNeeds your input (${flags.length}):`);
    for (const f of flags) console.log(`  \u26a0\ufe0f  ${f}`);
  }
};

main().catch((err) => {
  console.error(err.message ?? err);
  process.exitCode = 1;
});
