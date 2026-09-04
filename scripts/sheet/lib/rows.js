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
 * Read a saved tab into { header, rows }, keeping only rows the predicate
 * accepts.
 *
 * **Throws when a non-empty file yields zero rows.** `isDataRow` is shaped for
 * the two big form-backed tabs (email in column 1, name in column 2); the
 * Approvals tabs put the email in column 0, so the default predicate matched
 * nothing there and this function used to return an empty list — a silent zero
 * indistinguishable from "the tab really is empty". Abstaining loudly is the
 * rule (see CLAUDE.md), so a predicate that matches nothing is an error.
 *
 * @param {string} path
 * @param {(row: string[]) => boolean} [predicate]
 */
export const readTab = async (path, predicate = isDataRow) => {
  const all = parseCsv(await readFile(path, "utf8"));
  const header = all[0] ?? [];
  const body = all.slice(1);
  const rows = body.filter(predicate);

  if (rows.length === 0 && body.some((r) => r.some((c) => c.trim() !== ""))) {
    throw new Error(
      `${path}: the row predicate matched 0 of ${body.length} non-header ` +
        `rows, but the file is not empty.\n` +
        `This is almost always the wrong predicate for this tab rather than an ` +
        `empty tab — the default expects an email in column 1 and a name in ` +
        `column 2, which is the shape of Form Responses 1 and Speaking Events, ` +
        `not of the Approvals tabs.\n` +
        `Header: ${header.map((h, i) => `[${i}] ${JSON.stringify(h)}`).join(", ")}`,
    );
  }
  return { header, rows };
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
      // Day-first is this form's established convention, confirmed by values
      // like 17/10/2026 and by every ISO twin checked so far. So the parse is
      // not a guess. It is still *typographically* ambiguous when both parts
      // are <= 12 and differ, which `resolveDate` settles against the twin.
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
 * A bare number is EUR by this form's convention — most values are bare, and
 * flagging those would put a warning on almost every row and train us to
 * ignore it. Only a foreign symbol, a mixed signal, a hedged figure or
 * something unparseable is worth Ryan's attention.
 *
 * **The earlier calibration here was wrong, and worth knowing why.** It claimed
 * "51 non-empty values, none in another currency". That count came from
 * `.data/` CSVs produced by a whole-tab gviz read, which discards any cell it
 * cannot coerce to the column's inferred type — so every `£` value had already
 * been deleted before the calibration counted them. The workbook does contain
 * GBP (`£100`, `£150`, `£200`, `£0`) and hedged text (`<100 EUR (if allowed to
 * use my own car)`, `I don't need it, I'll be online`). See `probe.js`
 * `fetchRowsIndividually`. Measure on a repaired read, never a typed one.
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
 * An explicit decline: the speaker answered the cost question by saying they
 * do not want the money. Distinct from an empty cell, which is a speaker who
 * asked for support and left the estimate blank — that one still needs Ryan.
 */
const DECLINE_RE =
  /\b(?:don'?t|do not|dont)\s+need\b|\bnot needed\b|\bno (?:cost|need|budget|expense)s?\b|\bnothing\b|\bn\/?a\b|\bnone\b|\bonline\b|\bremote(?:ly)?\b/i;

/**
 * A figure the speaker hedged rather than stated: a bound (`<100`, `up to 80`),
 * an approximation (`~100`, `about 100`), or a range (`100-150`, `80 / 100`).
 *
 * These are NOT accepted automatically even when a number falls out cleanly.
 * Accepting a budget is Ryan's call, and `<100 EUR (if allowed to use my own
 * car)` is a conditional maximum, not a price — the number is a starting point
 * for his decision, not the decision.
 */
const HEDGE_RES = [
  [
    "a maximum, not a price",
    /^\s*(?:<|≤|<=|up to|max(?:imum)?\b|no more than)/i,
  ],
  [
    "an approximation",
    /~|\bapprox(?:\.|imately)?\b|\babout\b|\baround\b|\broughly\b|\bcirca\b|\bish\b/i,
  ],
  ["a range, not one figure", /\d\s*(?:-|–|—|\/|\bto\b|\bor\b)\s*\d/],
  [
    "conditional on something",
    /\bif\b|\bdepend(?:s|ing)?\b|\bprovided\b|\bassuming\b|\bshould\b/i,
  ],
];

/** First number in a hedged string, so Ryan gets a starting point not a blank. */
const firstNumber = (s) => {
  const m = s.match(/\d{1,7}(?:[.,]\d{1,3})?/);
  return m ? Number(m[0].replace(",", ".")) : null;
};

/**
 * Classify a cost estimate without ever converting it.
 *
 * @returns {{raw: string, empty: boolean, currencies: string[],
 *   amount: number|null, assumedEur: boolean, needsRyan: boolean,
 *   declined: boolean, hedged: string|null, why: string|null}}
 *   `needsRyan` means the workflow must stop and ask: the value is in a
 *   non-EUR currency, mixes currencies, is hedged rather than stated, or
 *   cannot be read as a single number. `amount` on a hedged value is a
 *   starting point for his decision, never an accepted figure.
 *   `declined` is the speaker saying they want no money — a real zero.
 */
export const classifyCost = (raw) => {
  const s = (raw ?? "").trim();
  const base = {
    raw: s,
    empty: false,
    currencies: [],
    amount: null,
    assumedEur: false,
    needsRyan: false,
    declined: false,
    hedged: null,
    why: null,
  };

  if (!s) return { ...base, empty: true };

  const currencies = CURRENCY_SIGNS.filter(([, re]) => re.test(s)).map(
    ([code]) => code,
  );
  const stripped = s
    .replace(/[€£$₹]|\b[A-Z]{3}\b|euros?|pounds?|dollars?/gi, "")
    .trim();
  const numeric = BARE_NUMBER_RE.test(stripped)
    ? Number(stripped.replace(",", "."))
    : null;

  // An explicit decline is an answer, not a gap. Checked before the number so
  // "I don't need it" never becomes a stop for Ryan to resolve — but only when
  // no figure is attached, since "no more than 100" also matches loosely.
  if (numeric === null && DECLINE_RE.test(s) && firstNumber(s) === null) {
    return {
      ...base,
      currencies,
      amount: 0,
      declined: true,
      why: "speaker declined the money",
    };
  }

  // A hedged figure outranks a clean parse: `<100` and `100-150` can both
  // yield a number, and treating either as the price would be us accepting a
  // budget on Ryan's behalf.
  const hedge = HEDGE_RES.find(([, re]) => re.test(s));
  if (hedge) {
    const [label] = hedge;
    const guess = numeric ?? firstNumber(s);
    const foreign = currencies.filter((c) => c !== "EUR");
    return {
      ...base,
      currencies,
      amount: guess,
      hedged: label,
      needsRyan: true,
      why:
        `${label}${guess === null ? "" : ` (reads as ${guess})`}` +
        (foreign.length ? ` and in ${foreign.join("/")}, not EUR` : "") +
        " — needs your figure",
    };
  }

  if (currencies.length > 1) {
    return {
      ...base,
      currencies,
      amount: numeric,
      needsRyan: true,
      why: `mixed currencies (${currencies.join("/")})`,
    };
  }
  if (currencies.length === 1 && currencies[0] !== "EUR") {
    return {
      ...base,
      currencies,
      amount: numeric ?? firstNumber(s),
      needsRyan: true,
      why: `${currencies[0]}, not EUR`,
    };
  }
  if (numeric === null) {
    // No hint here on purpose. `1.500,50` would yield 1.5, and a wrong number
    // beside a warning is worse than no number: it invites a glance instead of
    // a read of the raw value.
    return {
      ...base,
      currencies,
      needsRyan: true,
      why: "not a single readable number",
    };
  }
  return {
    ...base,
    currencies,
    amount: numeric,
    // A bare number carries no symbol; record that we supplied the currency.
    assumedEur: currencies.length === 0,
  };
};

/** Google Forms writes YES/Yes/yes inconsistently; compare case-insensitively. */
export const isYes = (v) => (v ?? "").trim().toLowerCase() === "yes";

/** A checkbox column holds the literal strings TRUE / FALSE. */
export const isChecked = (v) => (v ?? "").trim().toUpperCase() === "TRUE";

/**
 * Settle a `Form Responses 1` date against its `Speaking Events` twin.
 *
 * The two tabs are a row-for-row mirror, and Ryan norms toward `YYYY-MM-DD` by
 * hand over time — so the twin is frequently already ISO for a row the form
 * still holds as `DD/MM/YYYY`. That makes the twin an independent witness:
 *
 *   - twin agrees          -> confirmed, ambiguity resolved
 *   - twin is ISO and says otherwise -> a real conflict; ask, never pick
 *   - twin is also ambiguous -> unresolved; day-first stands but say so
 *
 * Measured on the live sheet: 4 of 112 rows differ in format, **0 in meaning**,
 * and 2 of the 3 typographically ambiguous rows are settled this way.
 *
 * @param {ReturnType<typeof parseStartDate>} primary  from Form Responses 1
 * @param {string} twinRaw  the same row's Speaking Events value
 */
export const resolveDate = (primary, twinRaw) => {
  const twin = parseStartDate(twinRaw);
  const twinIsIso =
    twin.iso !== null && !twin.ambiguous && ISO_RE.test((twinRaw ?? "").trim());

  if (primary.iso && twin.iso && primary.iso !== twin.iso) {
    return {
      ...primary,
      conflict: { twin: twin.iso, twinRaw: twin.raw },
      confirmedBy: null,
      ambiguous: primary.ambiguous,
    };
  }
  if (primary.iso && twin.iso && primary.iso === twin.iso) {
    return {
      ...primary,
      conflict: null,
      // An ISO twin agreeing settles the typographic ambiguity outright.
      confirmedBy: twinIsIso ? "iso-twin" : "twin",
      ambiguous: twinIsIso ? false : primary.ambiguous,
    };
  }
  return { ...primary, conflict: null, confirmedBy: null };
};
