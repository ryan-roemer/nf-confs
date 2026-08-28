/**
 * Turning saved gviz CSV into canonical records.
 *
 * All the sharp edges of this workbook live here — see docs/schema.md for how
 * each was found. Nothing in this file talks to a browser or to Notion.
 */

import { readFile } from "node:fs/promises";

/** Parse a whole CSV, handling quoted fields with embedded commas/newlines. */
export const parseCsv = (text) => {
  const rows = [];
  let row = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') {
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
      row.push(cur);
      cur = "";
      continue;
    }
    if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cur);
      rows.push(row);
      row = [];
      cur = "";
      continue;
    }
    cur += c;
  }
  if (cur !== "" || row.length > 0) {
    row.push(cur);
    rows.push(row);
  }
  return rows;
};

/**
 * A row is real data if it carries an email and an event name. Deliberately not
 * "has any non-empty cell": `Speaking Events` has formulas dragged ~1,580 rows
 * past the data, each emitting N,N,N,FALSE,FALSE. See docs/schema.md.
 */
export const isDataRow = (row) =>
  row.length > 2 && row[1]?.includes("@") && row[2]?.trim() !== "";

/**
 * Read a saved tab into { header, rows } with only real data rows.
 * @param {string} path
 */
export const readTab = async (path) => {
  const all = parseCsv(await readFile(path, "utf8"));
  return {
    header: all[0] ?? [],
    rows: all.slice(1).filter(isDataRow),
  };
};

/**
 * Locate a column by exact header text. Exact on purpose: this workbook has
 * both `Location ` (trailing space, index 5) and `Location` (index 23), and
 * trimming would collapse them.
 * @returns {number} index
 */
export const colIndex = (header, name) => {
  const i = header.indexOf(name);
  if (i === -1) {
    throw new Error(
      `Column not found: ${JSON.stringify(name)}\n` +
        `Available: ${header.map((h, n) => `[${n}] ${JSON.stringify(h)}`).join(", ")}`,
    );
  }
  return i;
};

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const SLASH_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

/**
 * Parse `Event start date`, which contains BOTH ISO and DD/MM/YYYY values in
 * the same column. Day-first is confirmed by values like 17/10/2026.
 *
 * Returns { iso, ambiguous, raw }. `ambiguous` is true when a slash date could
 * read either way (both parts <= 12) — the caller must not silently pick one.
 */
export const parseStartDate = (raw) => {
  const s = (raw ?? "").trim();
  if (!s) return { iso: null, ambiguous: false, raw: s, why: "empty" };

  const iso = ISO_RE.exec(s);
  if (iso) return { iso: s, ambiguous: false, raw: s };

  const sl = SLASH_RE.exec(s);
  if (sl) {
    const [, a, b, y] = sl;
    const day = Number(a);
    const month = Number(b);
    if (month > 12) {
      return { iso: null, ambiguous: false, raw: s, why: "month > 12" };
    }
    const pad = (n) => String(n).padStart(2, "0");
    return {
      iso: `${y}-${pad(month)}-${pad(day)}`,
      // Both <= 12 AND different means DD/MM and MM/DD give different real
      // dates. Equal parts (10/10) read the same either way.
      ambiguous: day <= 12 && day !== month,
      raw: s,
    };
  }
  return { iso: null, ambiguous: false, raw: s, why: "unrecognised format" };
};

/**
 * End date from a start date plus a duration in days. Duration 1 (or blank)
 * means a single-day event, so there is no end date.
 */
export const endDate = (startIso, durationDays) => {
  const n = Number(String(durationDays ?? "").trim());
  if (!startIso || !Number.isFinite(n) || n <= 1) return null;
  const d = new Date(`${startIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Math.round(n) - 1);
  return d.toISOString().slice(0, 10);
};

/**
 * Currency detection on a raw estimate string. Never converts.
 *
 * Calibrated against every cost value in the workbook (51 non-empty): 46 are
 * bare numbers, 5 carry an explicit `€`, and none is in another currency. So a
 * bare number is EUR by this form's convention — flagging those would put a
 * warning on almost every row and train us to ignore it. Only a foreign symbol,
 * a mixed signal, or something unparseable is worth Ryan's attention.
 */
const CURRENCY_SIGNS = [
  ["EUR", /€|\bEUR\b|\beuros?\b/i],
  ["GBP", /£|\bGBP\b|\bpounds?\b/i],
  ["USD", /\$|\bUSD\b|\bdollars?\b/i],
  ["CHF", /\bCHF\b/i],
  ["SEK", /\bSEK\b/i],
  ["NOK", /\bNOK\b/i],
  ["DKK", /\bDKK\b/i],
  ["PLN", /\bPLN\b|\bzł\b/i],
  ["CAD", /\bCAD\b/i],
  ["AUD", /\bAUD\b/i],
  ["INR", /₹|\bINR\b/i],
];

const BARE_NUMBER_RE = /^[\d]{1,7}(?:[.,]\d{1,3})?$/;

/**
 * Classify a cost estimate without ever converting it.
 *
 * @returns {{raw: string, empty: boolean, currencies: string[],
 *   amount: number|null, assumedEur: boolean, needsRyan: boolean,
 *   why: string|null}}
 *   `needsRyan` means the workflow must stop and ask: the value is in a
 *   non-EUR currency, mixes currencies, or cannot be read as a single number.
 */
export const classifyCost = (raw) => {
  const s = (raw ?? "").trim();
  if (!s) {
    return {
      raw: s,
      empty: true,
      currencies: [],
      amount: null,
      assumedEur: false,
      needsRyan: false,
      why: null,
    };
  }

  const currencies = CURRENCY_SIGNS.filter(([, re]) => re.test(s)).map(
    ([code]) => code,
  );
  const stripped = s
    .replace(/[€£$₹]|\b[A-Z]{3}\b|euros?|pounds?|dollars?/gi, "")
    .trim();
  const numeric = BARE_NUMBER_RE.test(stripped)
    ? Number(stripped.replace(",", "."))
    : null;

  if (currencies.length > 1) {
    return {
      raw: s,
      empty: false,
      currencies,
      amount: numeric,
      assumedEur: false,
      needsRyan: true,
      why: `mixed currencies (${currencies.join("/")})`,
    };
  }
  if (currencies.length === 1 && currencies[0] !== "EUR") {
    return {
      raw: s,
      empty: false,
      currencies,
      amount: numeric,
      assumedEur: false,
      needsRyan: true,
      why: `${currencies[0]}, not EUR`,
    };
  }
  if (numeric === null) {
    return {
      raw: s,
      empty: false,
      currencies,
      amount: null,
      assumedEur: false,
      needsRyan: true,
      why: "not a single readable number",
    };
  }
  return {
    raw: s,
    empty: false,
    currencies,
    amount: numeric,
    // A bare number carries no symbol; record that we supplied the currency.
    assumedEur: currencies.length === 0,
    needsRyan: false,
    why: null,
  };
};

/** Google Forms writes YES/Yes/yes inconsistently; compare case-insensitively. */
export const isYes = (v) => (v ?? "").trim().toLowerCase() === "yes";

/** A checkbox column holds the literal strings TRUE / FALSE. */
export const isChecked = (v) => (v ?? "").trim().toUpperCase() === "TRUE";
