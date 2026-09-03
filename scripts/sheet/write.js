#!/usr/bin/env node
/**
 * Stage 2 of the workflow: write the Approvals row and tick `Speaking`.
 *
 *   npm run sheet:write -- --event "DevFest Campobasso"           dry run
 *   npm run sheet:write -- --event "DevFest Campobasso" --apply   really write
 *
 * Dry run is the default and prints the exact cells it would touch.
 *
 * By default only the queue is selectable — a record whose `Speaking` is still
 * unchecked. `--backfill` widens the pool to records already marked done, for
 * the case where a processed row turns out to be missing its Approvals row.
 * It changes *what can be selected* and nothing else: every guard below still
 * applies, and a ticked `Speaking` is simply reported as a no-op.
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

import {
  CdpSession,
  getActiveTab,
  readCell,
  writeCell,
} from "../shared/cdp-session.js";
import { gvizCsv, pickTarget } from "../shared/cdp-eval.js";
import {
  assertMirrorIntact,
  backfillOf,
  loadRecords,
  queueOf,
} from "./lib/records.js";
import { parseCsv } from "./lib/rows.js";
import {
  findApprovalRow,
  firstBlankRow,
  resolveSheetRow,
} from "./lib/rowmap.js";

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

/**
 * Compare a typed value against what the sheet renders back.
 *
 * The money columns carry a currency format, so a typed `70` reads back as
 * `€70` — correct, but not string-equal. Confirmed on the live sheet: existing
 * rows show `€200`, `€70.00`, `€1,020`, all from bare numbers. So strip
 * currency decoration before comparing numerically, or the verifier cries wolf
 * on a write that is actually right.
 */
const sameNumber = (a, b) => {
  const clean = (v) =>
    String(v ?? "")
      .replace(/[€£$,\s]/g, "")
      .trim();
  const na = Number(clean(a));
  const nb = Number(clean(b));
  return (
    clean(a) !== "" &&
    clean(b) !== "" &&
    Number.isFinite(na) &&
    Number.isFinite(nb) &&
    na === nb
  );
};
/**
 * Today's date in Ryan's local timezone, as `YYYY-MM-DD`.
 *
 * This used to be `toISOString().slice(0, 10)`, which is UTC — so any run after
 * ~17:00 Pacific stamped `Date Approved` with *tomorrow's* date. It happened
 * once on 2026-08-28 (accepted as-is) and again on the Kubecon backfill; the
 * decision log's standing instruction was to switch on the second occurrence
 * rather than ask a third time. Local it is.
 */
const today = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

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
  const backfill = hasFlag("--backfill");
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

  // The default pool is the queue. `--backfill` selects from records the
  // workflow already finished — the only way to reach a row whose `Speaking`
  // is ticked but whose Approvals row was never written.
  const pool = backfill ? backfillOf(loaded.records) : queueOf(loaded.records);
  const noun = backfill ? "already-processed" : "queued";
  const matches = pool.filter((r) =>
    r.name.toLowerCase().includes(wanted.toLowerCase()),
  );
  if (matches.length !== 1) {
    const hint =
      matches.length === 0 &&
      !backfill &&
      backfillOf(loaded.records).some((r) =>
        r.name.toLowerCase().includes(wanted.toLowerCase()),
      )
        ? `\nIts \`Speaking\` is already ticked, so it is not in the queue. ` +
          `If a piece of its sheet output was missed, add --backfill.`
        : "";
    console.error(
      (matches.length === 0
        ? `No ${noun} record matches ${JSON.stringify(wanted)}.`
        : `${matches.length} ${noun} records match ${JSON.stringify(wanted)}: ` +
          `${matches.map((m) => m.name).join(", ")}. Be more specific.`) + hint,
    );
    process.exitCode = 1;
    return;
  }
  const record = matches[0];

  if (backfill) {
    console.log(
      `BACKFILL — this record is already processed (${record.triage.why}).\n` +
        `Filling in sheet output that was missed. Every guard still applies.\n`,
    );
  }

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
  let alreadyRecorded = null;
  if (needsApproval) {
    // Already in the Approved section? Then this is a rerun: do not append a
    // duplicate, and verify against the row that actually holds it.
    alreadyRecorded = await findApprovalRow(
      target,
      key,
      APPROVALS_TAB,
      { email: record.email, conf: record.name },
      APPROVALS.firstDataRow,
      APPROVALS.labelRow,
    );
    if (alreadyRecorded !== null) {
      appendRow = alreadyRecorded;
    } else {
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
    // State the reason the decision was actually made on. `needsBudget` reads
    // the three ask columns, not the engagement variant, so naming the variant
    // here would misreport a plain "Speak…" row that happens to ask for
    // nothing — the two are not the same set.
    console.log(
      `\n  ${APPROVALS_TAB}: skipped — leave, travel and hotel are all "no", ` +
        `nothing to approve.`,
    );
  } else {
    console.log(
      `\n  ${APPROVALS_TAB}, row ${appendRow}:` +
        (alreadyRecorded !== null
          ? "   ALREADY RECORDED — append skipped"
          : ""),
    );
    for (const [col, label, value] of approvalCells(record)) {
      console.log(
        value === null
          ? `    ${col}${appendRow}  ${label.padEnd(14)} — NOT WRITTEN (yours)`
          : `    ${col}${appendRow}  ${label.padEnd(14)} ${JSON.stringify(String(value))}`,
      );
    }
    console.log(`    J${appendRow}  Date Approved  ${JSON.stringify(today())}`);
  }

  if (!apply && !hasFlag("--verify")) {
    console.log(
      `\nNothing written. Add --apply to write, or --verify to check an existing write.`,
    );
    return;
  }

  const verifyOnly = hasFlag("--verify") && !apply;

  // --- Preconditions. If the browser is not ready, that is Ryan's to fix. ---
  // --- Write, unless we are only verifying an earlier run. ---
  if (!verifyOnly) {
    const session = await CdpSession.open(GOOGLE);
    try {
      // Front the workbook tab before any navigation. A backgrounded Sheets tab
      // is throttled hard enough that the worksheet switch in `gotoCell` can
      // miss its wait, which trips the worksheet guard and refuses a correct
      // write. Advisory only — reported, never fatal.
      const fronted = await session.activate();
      if (!fronted) {
        console.log(
          `\n  note: could not confirm the workbook tab is frontmost — if the ` +
            `worksheet guard refuses below, front that tab and rerun.`,
        );
      }

      const ready = await session.evaluate(`
        (() => ({
          url: location.href,
          editor: !!document.querySelector("#t-name-box"),
          signInWall: /accounts[.]google[.]com|ServiceLogin/.test(location.href),
        }))()
      `);

      if (ready.signInWall || !ready.url.includes(key)) {
        throw new Error(
          `The conference Chrome is not sitting on the workbook.\n` +
            `  current tab: ${ready.url}\n\n` +
            `Over to you — open the workbook in that Chrome (and sign in if it is\n` +
            `asking), then rerun:\n` +
            `  npm run chrome:login\n` +
            `  https://docs.google.com/spreadsheets/d/${key}/edit`,
        );
      }
      if (!ready.editor) {
        throw new Error(
          `The Sheets editor has not loaded in that tab (no Name Box).\n` +
            `  current tab: ${ready.url}\n\n` +
            `Over to you — let it finish loading, or reload it, then rerun.`,
        );
      }
      console.log(
        `\n  editor ready, active tab: ${JSON.stringify(await getActiveTab(session))}`,
      );

      // --- Identity check IN THE WRITE'S OWN COORDINATE SPACE. ---
      // resolveSheetRow proved the row via gviz, which addresses by tab name.
      // Typing addresses by what the Name Box selected. Those are different
      // paths, so the identity has to be re-proved on the path we will type
      // through, or a navigation failure can still land us on a live record.
      const seenEmail = await readCell(
        session,
        SPEAKING_TAB,
        `B${speakRow.row}`,
      );
      const seenName = await readCell(
        session,
        SPEAKING_TAB,
        `C${speakRow.row}`,
      );
      if (
        seenEmail.trim().toLowerCase() !== record.email.trim().toLowerCase() ||
        seenName.trim() !== record.name.trim()
      ) {
        throw new Error(
          `Refusing to write. ${SPEAKING_TAB} row ${speakRow.row} holds\n` +
            `  ${JSON.stringify(seenEmail)} / ${JSON.stringify(seenName)}\n` +
            `but this record is\n` +
            `  ${JSON.stringify(record.email)} / ${JSON.stringify(record.name)}`,
        );
      }
      console.log(
        `  identity confirmed at ${SPEAKING_TAB} row ${speakRow.row}`,
      );

      const blank = (c) => c.trim() === "";
      const results = [];

      // --- Approvals row: one cell at a time, each verified. ---
      if (needsApproval && alreadyRecorded === null) {
        const cells = approvalCells(record)
          .filter(([, , v]) => v !== null && String(v) !== "")
          .map(([col, label, value]) => ({ col, label, value }));
        cells.push({ col: "J", label: "Date Approved", value: today() });

        // Every target must be empty before we touch anything.
        for (const { col } of cells) {
          const cur = await readCell(
            session,
            APPROVALS_TAB,
            `${col}${appendRow}`,
          );
          if (!blank(cur)) {
            throw new Error(
              `Refusing to write: ${APPROVALS_TAB}!${col}${appendRow} is not ` +
                `empty — it contains ${JSON.stringify(cur)}.\n` +
                `Nothing has been written.`,
            );
          }
        }
        console.log(
          `  all ${cells.length} target cells in row ${appendRow} confirmed empty`,
        );

        for (const { col, label, value } of cells) {
          const r = await writeCell(session, {
            tab: APPROVALS_TAB,
            ref: `${col}${appendRow}`,
            value,
            allow: blank,
            allowDescription: "the cell must be empty",
          });
          results.push({
            where: `${APPROVALS_TAB}!${col}${appendRow}`,
            label,
            ...r,
          });
          console.log(
            `  ${r.ok ? "ok  " : "FAIL"} ${col}${appendRow} ${label} -> ${JSON.stringify(r.after)}`,
          );
          if (!r.ok) {
            throw new Error(
              `${col}${appendRow} did not verify (wrote ${JSON.stringify(String(value))}, ` +
                `read back ${JSON.stringify(r.after)}). Stopping before any further cell.`,
            );
          }
        }
      }

      // --- The Speaking checkbox. ---
      if (alreadyTicked) {
        console.log(
          `  ${SPEAKING_COL}${speakRow.row} Speaking already TRUE — nothing to do`,
        );
      } else {
        const r = await writeCell(session, {
          tab: SPEAKING_TAB,
          ref: `${SPEAKING_COL}${speakRow.row}`,
          value: "TRUE",
          allow: (c) => /^(TRUE|FALSE)$/i.test(c.trim()),
          allowDescription:
            "a checkbox cell must currently read exactly TRUE or FALSE",
        });
        results.push({
          where: `${SPEAKING_TAB}!${SPEAKING_COL}${speakRow.row}`,
          label: "Speaking",
          ...r,
        });
        console.log(
          `  ${r.ok ? "ok  " : "FAIL"} ${SPEAKING_COL}${speakRow.row} Speaking -> ${JSON.stringify(r.after)}`,
        );
        if (!r.ok) throw new Error(`Speaking checkbox did not verify.`);
      }
    } finally {
      session.close();
    }
  }

  // --- Independent confirmation via gviz: a second, different path. ---
  console.log(`\nIndependent read-back (gviz, addressed by tab name):`);
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
    `  ${tickOk ? "ok  " : "FAIL"} ${SPEAKING_TAB}!${SPEAKING_COL}${speakRow.row} = ${JSON.stringify(tick)}`,
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
    const want = approvalCells(record).map(([, , v]) =>
      v === null ? "" : String(v),
    );
    want.push("", today());
    for (let i = 0; i < want.length; i++) {
      const col = String.fromCharCode(65 + i);
      const got = unquote(back[i]);
      const ok = got === want[i] || sameNumber(got, want[i]);
      if (!ok) failures += 1;
      console.log(
        `  ${ok ? "ok  " : "FAIL"} ${APPROVALS_TAB}!${col}${appendRow} expected ${JSON.stringify(want[i])}, got ${JSON.stringify(got)}`,
      );
    }
  }

  console.log(
    failures === 0
      ? `\nAll cells verified on both paths. Email/Slack Sent left unchecked — yours.`
      : `\n${failures} cell(s) did NOT verify. Treat this write as FAILED and inspect the sheet.`,
  );
  if (failures > 0) process.exitCode = 1;
};

main().catch((err) => {
  console.error(err.message ?? err);
  process.exitCode = 1;
});
