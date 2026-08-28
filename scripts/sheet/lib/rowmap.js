/**
 * Resolving a record to its TRUE sheet row.
 *
 * The bug this exists to prevent, found 2026-08-28 against the live sheet:
 * `gviz` collapses blank rows, so a record's position in the CSV is not its row
 * in the sheet. `Form Responses 1` holds 3 blank rows, which made every record
 * after them off by 3. Writing the `Speaking` checkbox at the CSV-derived row
 * 111 would have ticked it on "Software Development Superstream" — a different
 * person's entry — and the write would have read back as a success.
 *
 * So: never write to a row number derived from CSV position. Resolve it by
 * reading the row back and confirming the identity that is supposed to be
 * there.
 *
 * Blank rows only ever push content DOWN, so the CSV-derived number is a lower
 * bound. Scanning downward from it is cheap and terminates.
 */

import { gvizCsv } from "../../shared/cdp-eval.js";
import { parseCsv } from "./rows.js";

/** How far past the estimate to look before giving up. */
const MAX_SCAN = 40;

const unquote = (s) => (s ?? "").trim().replace(/^"|"$/g, "");

/**
 * Read one row's identity columns (B = email, C = event name) on the two
 * form-backed tabs.
 * @returns {{email: string, name: string}}
 */
const readIdentity = async (target, key, tab, row) => {
  const text = await gvizCsv(target, key, tab, `B${row}:C${row}`);
  const cells = parseCsv(text)[0] ?? [];
  return { email: unquote(cells[0]), name: unquote(cells[1]) };
};

/**
 * Is every cell across `cols` blank on this row?
 *
 * Must span the whole row, not a guessed pair of columns. The Approvals tab's
 * section labels (`Approved`, `In consideration`) occupy column A alone, so a
 * B:C check reports the label row as blank and would append on top of it.
 */
const isRowBlank = async (target, key, tab, row, cols = "A:J") => {
  const [first, last] = cols.split(":");
  const text = await gvizCsv(target, key, tab, `${first}${row}:${last}${row}`);
  const cells = parseCsv(text)[0] ?? [];
  return cells.every((c) => unquote(c) === "");
};

/**
 * Find the true sheet row for a record.
 *
 * @param {object} target CDP page target on a signed-in google.com tab
 * @param {string} key spreadsheet key
 * @param {string} tab tab name
 * @param {{email: string, name: string, sheetRow: number}} record
 * @returns {Promise<{row: number, offset: number, scanned: number}>}
 * @throws when no row in range matches — never guesses.
 */
export const resolveSheetRow = async (target, key, tab, record) => {
  const want = {
    email: record.email.trim().toLowerCase(),
    name: record.name.trim(),
  };

  for (let i = 0; i < MAX_SCAN; i++) {
    const row = record.sheetRow + i;
    const got = await readIdentity(target, key, tab, row);
    if (got.email.toLowerCase() === want.email && got.name === want.name) {
      return { row, offset: i, scanned: i + 1 };
    }
  }

  throw new Error(
    `Could not locate ${JSON.stringify(record.name)} (${record.email}) in ` +
      `tab ${JSON.stringify(tab)} within ${MAX_SCAN} rows of the estimated ` +
      `row ${record.sheetRow}.\n` +
      `Refusing to write — a wrong row number here ticks a checkbox on ` +
      `someone else's entry.`,
  );
};

/**
 * Resolve a whole queue, and report coverage. Every record must resolve, or
 * nothing is safe to write.
 */
export const resolveAll = async (target, key, tab, records) => {
  const resolved = [];
  const failed = [];
  for (const r of records) {
    try {
      const hit = await resolveSheetRow(target, key, tab, r);
      resolved.push({ record: r, ...hit });
    } catch (err) {
      failed.push({ record: r, why: err.message.split("\n")[0] });
    }
  }
  return { resolved, failed, total: records.length };
};

/**
 * Find the first blank row at or after `from` — where an Approvals entry gets
 * appended. Stops at `stopBefore` (the row holding a section label), because
 * writing at or past it would file the entry under the wrong heading.
 */
export const firstBlankRow = async (
  target,
  key,
  tab,
  from,
  stopBefore,
  cols = "A:J",
) => {
  for (let row = from; row < stopBefore; row++) {
    if (await isRowBlank(target, key, tab, row, cols)) {
      return { row, stopped: false };
    }
  }
  return { row: null, stopped: true, stopBefore };
};
