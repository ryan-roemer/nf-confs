#!/usr/bin/env node
/**
 * Stage 2 of the workflow: write the Approvals row and tick `Speaking`.
 *
 *   npm run sheet:write -- --event "DevFest Campobasso"           dry run
 *   npm run sheet:write -- --event "DevFest Campobasso" --apply   really write
 *
 * Dry run is the default and prints the exact cells it would touch.
 *
 * Safety rules this enforces, each earned from a real failure:
 *
 *  - **Rows are resolved, never derived.** gviz collapses blank rows, so a
 *    record's CSV position is not its sheet row — the live queue was off by 3,
 *    which would have ticked `Speaking` on another person's entry.
 *  - **The mirror is checked per row** before any write.
 *  - **Column G (`Actuals`) is never written** — it is Ryan's, for later.
 *  - **Column M (`Email/Slack Sent`) is never written** — that is Ryan's step,
 *    and it is the marker that takes the record out of the queue.
 *  - **Stops at the `In consideration` label.** Appending at or past it would
 *    file an approved entry under the wrong heading.
 *  - **Every write is read back** and compared. A write that cannot be verified
 *    is a failure, not a success.
 */

import { readFile } from "node:fs/promises";

import { CdpSession, gotoCell } from "../shared/cdp-session.js";
import { gvizCsv, pickTarget } from "../shared/cdp-eval.js";
import { assertMirrorIntact, loadRecords, queueOf } from "./lib/records.js";
import { parseCsv } from "./lib/rows.js";
import { firstBlankRow, resolveSheetRow } from "./lib/rowmap.js";

const GOOGLE = /\.google\.com$/i;
const FORM_TAB = "Form Responses 1";
const SPEAKING_TAB = "Speaking Events";
const APPROVALS_TAB = "2026 Approvals";

/** Layout of `2026 Approvals`, verified against the live sheet 2026-08-28. */
const APPROVALS = {
  firstDataRow: 5, // 1 headers, 2 totals, 3 blank, 4 the "Approved" label
  labelRow: 26, // the "In consideration" label — a hard stop
};

/** `Speaking` is column L on `Speaking Events`; `Email/Slack Sent` is M. */
const SPEAKING_COL = "L";

const args = process.argv.slice(2);
const hasFlag = (n) => args.includes(n);
const argValue = (n) => {
  const i = args.indexOf(n);
  return i === -1 ? null : args[i + 1];
};

const unquote = (s) => (s ?? "").trim().replace(/^"|"$/g, "");
const today = () => new Date().toISOString().slice(0, 10);

/** The cells an Approvals row is made of. `null` means "tab past, write nothing". */
const approvalCells = (record) => [
  ["A", "Email", record.email],
  ["B", "Conf", record.name],
  ["C", "Date", record.date.iso],
  ["D", "Travel", record.ask.travelCost.amount ?? ""],
  ["E", "Accomodations", record.ask.hotelCost.amount ?? ""],
  ["F", "Total", record.ask.total ?? ""],
  ["G", "Actuals", null],
  ["H", "Leave Days", record.ask.leave ? 1 : ""],
];

const main = async () => {
  const wanted = argValue("--event");
  const apply = hasFlag("--apply");
  if (!wanted) {
    console.error(
      'Which record? e.g.\n  npm run sheet:write -- --event "DevFest Campobasso"',
    );
    process.exitCode = 1;
    return;
  }

  const cfg = JSON.parse(await readFile("config/targets.json", "utf8"));
  const key = cfg.sheet.key;

  const loaded = await loadRecords();
  for (const w of loaded.warnings) console.warn(`Warning: ${w}\n`);
  assertMirrorIntact(loaded);

  const matches = queueOf(loaded.records).filter((r) =>
    r.name.toLowerCase().includes(wanted.toLowerCase()),
  );
  if (matches.length !== 1) {
    console.error(
      matches.length === 0
        ? `No queued record matches ${JSON.stringify(wanted)}.`
        : `${matches.length} queued records match ${JSON.stringify(wanted)}: ` +
            `${matches.map((m) => m.name).join(", ")}. Be more specific.`,
    );
    process.exitCode = 1;
    return;
  }
  const record = matches[0];

  const target = await pickTarget(GOOGLE);

  // --- Resolve the true rows. Never trust CSV position. ---
  const formRow = await resolveSheetRow(target, key, FORM_TAB, record);
  const speakRow = await resolveSheetRow(target, key, SPEAKING_TAB, record);
  if (formRow.row !== speakRow.row) {
    throw new Error(
      `The two tabs disagree on this record's row: ${FORM_TAB} row ` +
        `${formRow.row}, ${SPEAKING_TAB} row ${speakRow.row}. Refusing to write.`,
    );
  }

  const current = unquote(
    parseCsv(
      await gvizCsv(
        target,
        key,
        SPEAKING_TAB,
        `${SPEAKING_COL}${speakRow.row}:${SPEAKING_COL}${speakRow.row}`,
      ),
    )[0]?.[0],
  );
  const alreadyTicked = current.toUpperCase() === "TRUE";

  // --- Where does the Approvals row go? ---
  const needsApproval = record.needsBudget;
  let appendRow = null;
  if (needsApproval) {
    const blank = await firstBlankRow(
      target,
      key,
      APPROVALS_TAB,
      APPROVALS.firstDataRow,
      APPROVALS.labelRow,
    );
    if (!blank.row) {
      throw new Error(
        `No blank row left in the "Approved" section before the ` +
          `"In consideration" label at row ${APPROVALS.labelRow}.\n` +
          `Move that label further down by hand, then rerun. Not doing it for you.`,
      );
    }
    appendRow = blank.row;
  }

  // --- Report the plan ---
  console.log(`${apply ? "WRITING" : "DRY RUN"} — ${record.name}`);
  console.log("=".repeat(60));
  console.log(`  submitter    ${record.email}`);
  console.log(
    `  sheet row    ${formRow.row}  (CSV position said ${record.sheetRow}; offset +${formRow.offset})`,
  );
  console.log(`  mirror       verified on both tabs at row ${formRow.row}`);

  console.log(`\n  ${SPEAKING_TAB}:`);
  console.log(
    `    ${SPEAKING_COL}${speakRow.row}  Speaking = TRUE` +
      (alreadyTicked
        ? "   (already TRUE — no-op)"
        : `   (currently ${current || "empty"})`),
  );
  console.log(`    M${speakRow.row}  Email/Slack Sent — NOT TOUCHED (yours)`);

  if (!needsApproval) {
    console.log(
      `\n  ${APPROVALS_TAB}: skipped — "without requesting support or swag", ` +
        `nothing to approve.`,
    );
  } else {
    console.log(`\n  ${APPROVALS_TAB}, row ${appendRow}:`);
    for (const [col, label, value] of approvalCells(record)) {
      console.log(
        value === null
          ? `    ${col}${appendRow}  ${label.padEnd(14)} — NOT WRITTEN (yours)`
          : `    ${col}${appendRow}  ${label.padEnd(14)} ${JSON.stringify(String(value))}`,
      );
    }
    console.log(`    J${appendRow}  Date Approved  ${JSON.stringify(today())}`);
  }

  if (!apply) {
    console.log(`\nNothing written. Add --apply to write.`);
    return;
  }

  // --- Write ---
  const session = await CdpSession.open(GOOGLE);
  try {
    await session.send("Page.enable");
    await session.send("Page.navigate", {
      url: `https://docs.google.com/spreadsheets/d/${key}/edit`,
    });
    for (let i = 0; i < 40; i++) {
      await session.wait(1000);
      if (await session.evaluate(`!!document.querySelector("#t-name-box")`))
        break;
    }
    await session.wait(2500);

    const selectTab = async (name) => {
      const ok = await session.evaluate(`
        (() => {
          const tabs = [...document.querySelectorAll(".docs-sheet-tab-name")];
          const t = tabs.find((e) => e.textContent.trim() === ${JSON.stringify(name)});
          if (!t) return false;
          t.click();
          return true;
        })()
      `);
      if (!ok) throw new Error(`Worksheet tab not found: ${name}`);
      await session.wait(1500);
    };

    if (needsApproval) {
      await selectTab(APPROVALS_TAB);
      await gotoCell(session, `A${appendRow}`);
      for (const [, , value] of approvalCells(record)) {
        if (value !== null) await session.type(String(value));
        await session.press("Tab");
      }
      await session.press("Enter");
      await session.wait(800);

      await gotoCell(session, `J${appendRow}`);
      await session.type(today());
      await session.press("Enter");
      await session.wait(1200);
      console.log(`\n  wrote ${APPROVALS_TAB} row ${appendRow}`);
    }

    if (!alreadyTicked) {
      await selectTab(SPEAKING_TAB);
      await gotoCell(session, `${SPEAKING_COL}${speakRow.row}`);
      await session.type("TRUE");
      await session.press("Enter");
      await session.wait(1200);
      console.log(`  wrote ${SPEAKING_TAB} ${SPEAKING_COL}${speakRow.row}`);
    }
  } finally {
    session.close();
  }

  // --- Read back and verify. Cells, never the header row. ---
  console.log(`\nVerifying by reading the cells back:`);
  let failures = 0;

  const tick = unquote(
    parseCsv(
      await gvizCsv(
        target,
        key,
        SPEAKING_TAB,
        `${SPEAKING_COL}${speakRow.row}:${SPEAKING_COL}${speakRow.row}`,
      ),
    )[0]?.[0],
  );
  const tickOk = tick.toUpperCase() === "TRUE";
  if (!tickOk) failures += 1;
  console.log(
    `  ${tickOk ? "ok  " : "FAIL"} ${SPEAKING_COL}${speakRow.row} Speaking = ${JSON.stringify(tick)}`,
  );

  if (needsApproval) {
    const back =
      parseCsv(
        await gvizCsv(
          target,
          key,
          APPROVALS_TAB,
          `A${appendRow}:J${appendRow}`,
        ),
      )[0] ?? [];
    const expected = approvalCells(record).map(([, , v]) =>
      v === null ? "" : String(v),
    );
    expected.push(""); // I, spacer
    expected.push(today()); // J
    for (let i = 0; i < expected.length; i++) {
      const col = String.fromCharCode(65 + i);
      const got = unquote(back[i]);
      // Sheets may render a number or date differently than typed; compare loosely.
      const ok =
        got === expected[i] || Number(got) === Number(expected[i] || NaN);
      if (!ok) failures += 1;
      console.log(
        `  ${ok ? "ok  " : "FAIL"} ${col}${appendRow} expected ${JSON.stringify(expected[i])}, got ${JSON.stringify(got)}`,
      );
    }
  }

  console.log(
    failures === 0
      ? `\nAll cells verified. Email/Slack Sent left unchecked — yours to do.`
      : `\n${failures} cell(s) did NOT verify. Treat this write as FAILED and inspect the sheet.`,
  );
  if (failures > 0) process.exitCode = 1;
};

main().catch((err) => {
  console.error(err.message ?? err);
  process.exitCode = 1;
});
