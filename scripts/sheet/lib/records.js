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
  const start = parseStartDate(g(form, fi[C.start]));
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
 * Why a record is or isn't in the queue. `Email/Slack Sent` is the only
 * processed marker — `Speaking` merely says "this is a speaking engagement" and
 * may be ticked early by someone else. See docs/workflow.md.
 */
export const triage = (r) => {
  if (!r.isSpeaking) {
    return { state: "skip", why: `not speaking: ${r.engagement}` };
  }
  if (r.marks.emailSlackSent) {
    return { state: "done", why: "Email/Slack Sent is checked" };
  }
  if (r.marks.speaking) {
    return {
      state: "part",
      why: "Speaking checked but Email/Slack Sent not — may already be in Notion",
    };
  }
  return { state: "pending", why: "Email/Slack Sent unchecked" };
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
    const r = toRecord(row, fi, speak.rows[i], si, i);
    return { ...r, triage: triage(r) };
  });

  return { records, warnings };
};

/** The records this workflow acts on: speaking, not yet processed. */
export const queueOf = (records) =>
  records.filter(
    (r) => r.triage.state === "pending" || r.triage.state === "part",
  );
