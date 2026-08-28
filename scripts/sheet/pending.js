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

import {
  classifyCost,
  colIndex,
  endDate,
  isChecked,
  isYes,
  parseStartDate,
  readTab,
} from "./lib/rows.js";

const FORM = ".data/sheet/0-form-responses-1.csv";
const SPEAKING = ".data/sheet/1-speaking-events.csv";

/**
 * Any `Proposed engagement: ` value starting with "Speak" is a speaking
 * engagement — the form has grown suffixed variants over time and will grow
 * more, so match the prefix rather than enumerating them.
 */
const SPEAK_RE = /^\s*speak/i;

/**
 * The variant that explicitly asks for nothing. These still belong in the
 * Events Calendar but skip the Approvals write, since there is no budget to
 * approve.
 */
const NO_SUPPORT_RE = /without requesting support/i;

const C = {
  email: "Email Address",
  name: "Name of the Event or Conference",
  start: "Event start date",
  duration: "Event duration (in days)",
  website: "Event website",
  cfp: "Event Call for Papers (CFP) link (if applicable)",
  location: "Location ",
  engagement: "Proposed engagement: ",
  category: "Event Category ",
  audience: "Audience:",
  leave:
    "Do you need to use the Event Speaking Program Leave to cover up to 1 day of Leave for the event?",
  travel:
    "Do you need to use the Event Speaking Program to cover travel costs?",
  hotel:
    "Do you need to use the Event Speaking Program to cover up to 2 nights of accommodations for the event? Please use common sense taking into account the distance and duration of the event.",
  travelCost:
    "If using the Event Speaking Program for travel, please provide an estimate of the costs",
  hotelCost:
    "If using the Event Speaking Program for accomodations, please provide an estimate costs",
};

const args = process.argv.slice(2);
const hasFlag = (n) => args.includes(n);

/** Build one canonical record from a form row and its Speaking Events twin. */
const toRecord = (form, fi, speak, si, index) => {
  const g = (row, i) => (row?.[i] ?? "").trim();
  const engagement = g(form, fi[C.engagement]);
  const start = parseStartDate(g(form, fi[C.start]));
  const duration = g(form, fi[C.duration]);

  return {
    // 1-based row number as it appears in the sheet, header included.
    sheetRow: index + 2,
    email: g(form, fi[C.email]),
    name: g(form, fi[C.name]),
    engagement,
    isSpeaking: SPEAK_RE.test(engagement),
    needsBudget: SPEAK_RE.test(engagement) && !NO_SUPPORT_RE.test(engagement),
    website: g(form, fi[C.website]),
    cfpLink: g(form, fi[C.cfp]),
    location: g(form, fi[C.location]),
    category: g(form, fi[C.category]),
    audience: g(form, fi[C.audience]),
    date: { ...start, duration, endIso: endDate(start.iso, duration) },
    ask: {
      leave: isYes(g(form, fi[C.leave])),
      travel: isYes(g(form, fi[C.travel])),
      hotel: isYes(g(form, fi[C.hotel])),
      travelCost: classifyCost(g(form, fi[C.travelCost])),
      hotelCost: classifyCost(g(form, fi[C.hotelCost])),
    },
    marks: {
      speaking: isChecked(g(speak, si.speaking)),
      emailSlackSent: isChecked(g(speak, si.emailSlackSent)),
      funded: g(speak, si.funded),
    },
  };
};

/** Why this record is or isn't in the queue. Stated, never implied. */
const triage = (r) => {
  if (!r.isSpeaking)
    return { state: "skip", why: `not speaking: ${r.engagement}` };
  if (r.marks.emailSlackSent)
    return { state: "done", why: "Email/Slack Sent is checked" };
  if (r.marks.speaking)
    return {
      state: "part",
      why: "Speaking checked but Email/Slack Sent not — accepted already?",
    };
  return { state: "pending", why: "Email/Slack Sent unchecked" };
};

const money = (c) => {
  if (c.empty) return "—";
  if (c.needsRyan) return `${c.raw}  ⚠️ ${c.why} — needs your EUR figure`;
  return `${c.raw}${c.assumedEur ? "  (EUR assumed — no symbol given)" : ""}`;
};

const printRecord = (r, t) => {
  const dateStr = r.date.iso
    ? `${r.date.iso}${r.date.endIso ? ` → ${r.date.endIso}` : ""}` +
      (r.date.ambiguous ? "  ⚠️ AMBIGUOUS day/month" : "")
    : `⚠️ unparsed (${r.date.raw || "empty"}${r.date.why ? `: ${r.date.why}` : ""})`;

  console.log(`\n  row ${r.sheetRow}  ${r.name}`);
  console.log(`    ${r.email}`);
  console.log(`    date       ${dateStr}   duration=${r.date.duration || "—"}`);
  console.log(`    website    ${r.website || "⚠️ none"}`);
  console.log(`    location   ${r.location || "—"}`);
  if (!r.needsBudget) {
    console.log(`    ask        none — "without requesting support or swag"`);
  } else {
    console.log(
      `    ask        leave=${r.ask.leave ? "YES" : "no"}  ` +
        `travel=${r.ask.travel ? "YES" : "no"}  hotel=${r.ask.hotel ? "YES" : "no"}`,
    );
    console.log(`    travel     ${money(r.ask.travelCost)}`);
    console.log(`    hotel      ${money(r.ask.hotelCost)}`);
    const t = (r.ask.travelCost.amount ?? 0) + (r.ask.hotelCost.amount ?? 0);
    const partial = r.ask.travelCost.needsRyan || r.ask.hotelCost.needsRyan;
    console.log(
      `    total      ${t || "—"}${partial ? "  ⚠️ incomplete, see above" : ""}`,
    );
  }
  console.log(
    `    marks      Speaking=${r.marks.speaking} Email/Slack Sent=${r.marks.emailSlackSent} Funded=${r.marks.funded || "—"}`,
  );
  console.log(`    triage     ${t.state.toUpperCase()} — ${t.why}`);
};

const main = async () => {
  const form = await readTab(FORM);
  const speak = await readTab(SPEAKING);

  const fi = Object.fromEntries(
    Object.values(C).map((name) => [name, colIndex(form.header, name)]),
  );
  const si = {
    funded: colIndex(speak.header, "Funded"),
    speaking: colIndex(speak.header, "Speaking"),
    emailSlackSent: colIndex(speak.header, "Email/Slack Sent"),
  };

  if (form.rows.length !== speak.rows.length) {
    console.warn(
      `Warning: Form Responses 1 has ${form.rows.length} data rows but ` +
        `Speaking Events has ${speak.rows.length}. They are a row-for-row ` +
        `mirror, so a mismatch means the pairing below may be wrong.\n`,
    );
  }

  const records = form.rows.map((row, i) =>
    toRecord(row, fi, speak.rows[i], si, i),
  );
  const triaged = records.map((r) => ({ r, t: triage(r) }));

  if (hasFlag("--json")) {
    console.log(
      JSON.stringify(
        triaged.map(({ r, t }) => ({ ...r, triage: t })),
        null,
        2,
      ),
    );
    return;
  }

  const show = hasFlag("--all")
    ? triaged.filter(({ r }) => r.isSpeaking)
    : triaged.filter(({ t }) => t.state === "pending" || t.state === "part");

  console.log("Speaking entries awaiting you");
  console.log("=============================");

  for (const { r, t } of show) printRecord(r, t);

  // Coverage, always. A quiet queue and a broken read must not look alike.
  const count = (s) => triaged.filter(({ t }) => t.state === s).length;
  console.log(`\n\nRead ${records.length} data rows from ${FORM}.`);
  console.log(
    `  speaking engagements   ${records.filter((r) => r.isSpeaking).length}` +
      ` (${records.filter((r) => r.needsBudget).length} with a budget ask, ` +
      `${records.filter((r) => r.isSpeaking && !r.needsBudget).length} without)`,
  );
  console.log(`  pending                ${count("pending")}`);
  console.log(`  part-processed          ${count("part")}`);
  console.log(`  done                   ${count("done")}`);
  console.log(`  not speaking (skipped) ${count("skip")}`);
  console.log(
    `\nShowing ${show.length}. Use --all for every speaking row, --json for the full data.`,
  );

  const flags = [];
  for (const { r, t } of triaged) {
    if (t.state === "skip" || t.state === "done") continue;
    if (r.date.ambiguous)
      flags.push(`row ${r.sheetRow}: ambiguous date ${r.date.raw}`);
    if (!r.date.iso)
      flags.push(`row ${r.sheetRow}: unparsed date ${r.date.raw || "(empty)"}`);
    if (!r.website)
      flags.push(
        `row ${r.sheetRow}: no Event website — URL matching impossible`,
      );
    if (r.ask.travelCost.needsRyan)
      flags.push(
        `row ${r.sheetRow}: travel cost ${r.ask.travelCost.why} — ${r.ask.travelCost.raw}`,
      );
    if (r.ask.hotelCost.needsRyan)
      flags.push(
        `row ${r.sheetRow}: hotel cost ${r.ask.hotelCost.why} — ${r.ask.hotelCost.raw}`,
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
    for (const f of flags) console.log(`  ⚠️  ${f}`);
  }
};

main().catch((err) => {
  console.error(err.message ?? err);
  process.exitCode = 1;
});
