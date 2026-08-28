/**
 * Canonical sheet records: the one place that knows how a Form Responses row
 * plus its Speaking Events twin become a record the rest of the pipeline uses.
 *
 * Field meanings and the workflow they serve are in docs/workflow.md; the
 * parsing quirks they work around are in docs/schema.md.
 */

import {
  classifyCost,
  colIndex,
  endDate,
  isChecked,
  isYes,
  parseStartDate,
  readTab,
  resolveDate,
} from "./rows.js";

export const FORM_CSV = ".data/sheet/0-form-responses-1.csv";
export const SPEAKING_CSV = ".data/sheet/1-speaking-events.csv";

/**
 * Any `Proposed engagement: ` value starting with "Speak" is a speaking
 * engagement — the form has grown suffixed variants over time and will grow
 * more, so match the prefix rather than enumerating them.
 */
export const SPEAK_RE = /^\s*speak/i;

/**
 * The variant that explicitly asks for nothing. Still belongs in the Events
 * Calendar, but skips the Approvals write — there is no budget to approve.
 */
export const NO_SUPPORT_RE = /without requesting support/i;

/** Exact header text for every column the workflow reads. */
export const C = {
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

const g = (row, i) => (row?.[i] ?? "").trim();

/** Build one canonical record from a form row and its Speaking Events twin. */
const toRecord = (form, fi, speak, si, index) => {
  const engagement = g(form, fi[C.engagement]);
  // The Speaking Events twin is an independent witness on the date: the two
  // tabs mirror each other and Ryan norms toward ISO by hand, so the twin is
  // often already unambiguous where the form is not.
  const start = resolveDate(
    parseStartDate(g(form, fi[C.start])),
    g(speak, si.start),
  );
  const duration = g(form, fi[C.duration]);
  const travelCost = classifyCost(g(form, fi[C.travelCost]));
  const hotelCost = classifyCost(g(form, fi[C.hotelCost]));

  return {
    // 1-based row number as it appears in the sheet, header included.
    sheetRow: index + 2,
    email: g(form, fi[C.email]),
    name: g(form, fi[C.name]),
    engagement,
    isSpeaking: SPEAK_RE.test(engagement),
    // An Approvals row exists only when something was actually requested.
    // Deriving this from the engagement variant instead would append a row
    // with no money and no leave days for any plain "Speak…" submission that
    // asks for nothing — a junk row in the Approved section.
    needsBudget:
      SPEAK_RE.test(engagement) &&
      (isYes(g(form, fi[C.leave])) ||
        isYes(g(form, fi[C.travel])) ||
        isYes(g(form, fi[C.hotel]))),
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
      travelCost,
      hotelCost,
      // null when either side needs Ryan, so a partial total is never treated
      // as authoritative.
      total:
        travelCost.needsRyan || hotelCost.needsRyan
          ? null
          : (travelCost.amount ?? 0) + (hotelCost.amount ?? 0),
    },
    marks: {
      speaking: isChecked(g(speak, si.speaking)),
      emailSlackSent: isChecked(g(speak, si.emailSlackSent)),
      funded: g(speak, si.funded),
    },
  };
};

/**
 * Why a record is or isn't in the queue.
 *
 * **`Speaking` checked in `Speaking Events` is what "processed" means.** It is
 * the workflow's terminal state, set last — after the Notion page exists and
 * after the Approvals row, if there is one. Nothing else marks completion:
 *
 *  - An Approvals row cannot, because an event with no leave and no budget ask
 *    never gets one, yet still has to be processed into Notion.
 *  - `Email/Slack Sent` cannot, because that is Ryan's own downstream step. It
 *    is informational here and drives nothing.
 *
 * The known cost: someone may tick `Speaking` early simply to categorise an
 * entry as a speaking engagement, and the workflow would then skip it silently.
 * That is a miss, not corruption, and runs are supervised. An audit
 * cross-checking `Speaking`-TRUE rows against Notion would catch it if it ever
 * starts happening.
 */
export const triage = (r) => {
  if (!r.isSpeaking) {
    return { state: "skip", why: `not speaking: ${r.engagement}` };
  }
  if (r.marks.speaking) {
    return {
      state: "done",
      why:
        "Speaking is checked — the workflow is finished with it" +
        (r.marks.emailSlackSent
          ? ""
          : " (your Email/Slack Sent still pending)"),
    };
  }
  return { state: "pending", why: "Speaking is unchecked" };
};

/**
 * Load every data row as a triaged record.
 * @returns {Promise<{records: object[], warnings: string[]}>}
 */
export const loadRecords = async () => {
  const form = await readTab(FORM_CSV);
  const speak = await readTab(SPEAKING_CSV);
  const warnings = [];

  const fi = Object.fromEntries(
    Object.values(C).map((name) => [name, colIndex(form.header, name)]),
  );
  const si = {
    email: colIndex(speak.header, "Email Address"),
    name: colIndex(speak.header, "Name of the Event or Conference"),
    start: colIndex(speak.header, "Event start date"),
    funded: colIndex(speak.header, "Funded"),
    speaking: colIndex(speak.header, "Speaking"),
    emailSlackSent: colIndex(speak.header, "Email/Slack Sent"),
  };

  if (form.rows.length !== speak.rows.length) {
    warnings.push(
      `Form Responses 1 has ${form.rows.length} data rows but Speaking Events ` +
        `has ${speak.rows.length}. They are a row-for-row mirror, so a ` +
        `mismatch means the pairing may be wrong.`,
    );
  }

  const records = form.rows.map((row, i) => {
    const twin = speak.rows[i];
    const r = toRecord(row, fi, twin, si, i);

    // The row-for-row mirror is an assumption, and every sheet write is
    // addressed by row index — so a slipped pairing would tick `Speaking` on
    // someone else's row. Verify identity per row, not just the row count.
    const mirror =
      twin &&
      g(row, fi[C.email]).toLowerCase() === g(twin, si.email).toLowerCase() &&
      g(row, fi[C.name]) === g(twin, si.name)
        ? { ok: true }
        : {
            ok: false,
            why: twin
              ? `form has ${JSON.stringify(g(row, fi[C.email]))}/` +
                `${JSON.stringify(g(row, fi[C.name]))} but Speaking Events row ` +
                `has ${JSON.stringify(g(twin, si.email))}/` +
                `${JSON.stringify(g(twin, si.name))}`
              : "no corresponding Speaking Events row",
          };

    return { ...r, mirror, triage: triage(r) };
  });

  const broken = records.filter((r) => !r.mirror.ok);
  if (broken.length > 0) {
    warnings.push(
      `${broken.length} of ${records.length} rows do not match their Speaking ` +
        `Events twin. Sheet writes are addressed by row index, so DO NOT WRITE ` +
        `until this is resolved:\n` +
        broken
          .slice(0, 5)
          .map((r) => `    row ${r.sheetRow}: ${r.mirror.why}`)
          .join("\n"),
    );
  }

  return { records, warnings, mirrorOk: broken.length === 0 };
};

/**
 * Guard for anything that writes to the sheet by row index. Callers must run
 * this before a write, not merely log the warning.
 */
export const assertMirrorIntact = ({ records, mirrorOk }) => {
  if (!mirrorOk) {
    const broken = records.filter((r) => !r.mirror.ok);
    throw new Error(
      `Refusing to write: ${broken.length} row(s) do not match their Speaking ` +
        `Events twin, and every sheet write is addressed by row index.\n` +
        broken.map((r) => `  row ${r.sheetRow}: ${r.mirror.why}`).join("\n"),
    );
  }
};

/** The records this workflow acts on: speaking, `Speaking` not yet checked. */
export const queueOf = (records) =>
  records.filter((r) => r.triage.state === "pending");
