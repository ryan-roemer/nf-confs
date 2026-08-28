/**
 * Matching a sheet record against existing Events Calendar pages.
 *
 * Pure functions over plain data — no browser, no Notion calls. The Notion rows
 * are fetched by the skill (only an MCP session can reach Notion) and handed to
 * this module as JSON.
 *
 * The central problem, found in the live data: **a recurring conference reuses
 * its URL across years.** `Come To Code 2024` and `Come To Code 2025` both have
 * `Link = https://www.cometocode.it/`; so do `We Make Future` and `We Make
 * Future 2026`. So a URL match alone is not an identity match — it identifies
 * the *conference series*, and the date identifies the *instance*.
 *
 * Meanwhile some organisers (GDG) put the year in the path, so the same series
 * has a different URL each year and URL matching under-matches instead.
 *
 * Hence: match on series (URL or name), then decide instance by year.
 */

/**
 * Reduce a URL to a comparable series key: host without `www.`, plus path with
 * a trailing slash removed. Query and fragment are dropped — they carry
 * tracking, not identity.
 *
 * The year is deliberately NOT stripped from the path. A year-bearing path is
 * genuinely a different instance, and conflating them would merge two real
 * events.
 * @returns {string|null} null when the input isn't a usable URL.
 */
export const urlKey = (raw) => {
  const s = (raw ?? "").trim();
  if (!s) return null;
  let u;
  try {
    u = new URL(s.includes("://") ? s : `https://${s}`);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  const path = u.pathname.toLowerCase().replace(/\/+$/, "");
  return `${host}${path}`;
};

/** Host alone, for the looser "same series, different landing page" test. */
export const urlHost = (raw) => {
  const k = urlKey(raw);
  return k ? k.split("/")[0] : null;
};

/**
 * Hosts that many unrelated events share, where a matching host says nothing
 * about identity. `gdg.community.dev` hosts every GDG DevFest worldwide, so
 * DevFest Roma and DevFest Campobasso share a host and are not remotely the
 * same event — without this, two unrelated events on nearby dates could score
 * as the same instance and be silently merged.
 *
 * A conference's own domain (cometocode.it, wemakefuture.it) is the opposite: a
 * shared host there is strong evidence of the same series.
 */
export const SHARED_EVENT_HOSTS = new Set([
  "gdg.community.dev",
  "sessionize.com",
  "meetup.com",
  "eventbrite.com",
  "eventbrite.co.uk",
  "ti.to",
  "lu.ma",
  "hopin.com",
  "events.linuxfoundation.org",
  "docs.google.com",
  "forms.gle",
  "community.nearform.com",
]);

/** True when a host is a shared platform, so host equality proves nothing. */
export const isSharedHost = (host) =>
  host !== null && SHARED_EVENT_HOSTS.has(host);

/**
 * Normalise a conference name for comparison: lowercase, drop a 4-digit year,
 * drop punctuation, collapse whitespace, and drop common edition words.
 *
 * Names are human-entered and vary by design (`JSConf NA 2025`,
 * `AI Native Dev Con 2026 - NYC`), so this is a similarity aid, never an
 * identity test.
 */
export const nameKey = (raw) =>
  (raw ?? "")
    .toLowerCase()
    .replace(/\b(19|20)\d{2}\b/g, " ")
    .replace(/\b(conf|conference|summit|edition|special)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");

/** Token overlap in [0,1]. Cheap and predictable; no fuzzy-distance surprises. */
export const nameSimilarity = (a, b) => {
  const ta = new Set(nameKey(a).split(" ").filter(Boolean));
  const tb = new Set(nameKey(b).split(" ").filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  let hit = 0;
  for (const t of ta) if (tb.has(t)) hit += 1;
  return hit / Math.max(ta.size, tb.size);
};

const yearOf = (iso) => {
  const m = /^(\d{4})-/.exec(iso ?? "");
  return m ? Number(m[1]) : null;
};

const daysApart = (a, b) => {
  if (!a || !b) return null;
  const ms = Math.abs(
    Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`),
  );
  return Math.round(ms / 86400000);
};

/** Notion multi-value columns arrive as JSON strings. */
export const parseList = (v) => {
  if (Array.isArray(v)) return v;
  if (typeof v !== "string" || v.trim() === "") return [];
  try {
    const p = JSON.parse(v);
    return Array.isArray(p) ? p : [p];
  } catch {
    return [v];
  }
};

const NAME_STRONG = 0.75;
const NAME_WEAK = 0.45;
const DATE_NEAR_DAYS = 4;

/**
 * Score one Notion page against one sheet record.
 * @returns {{page: object, signals: string[], sameSeries: boolean,
 *   sameInstance: boolean, score: number}}
 */
export const scoreCandidate = (record, page) => {
  const signals = [];

  const rKey = urlKey(record.website);
  const pKey = urlKey(page.Link);
  const rHost = urlHost(record.website);
  const urlExact = rKey !== null && rKey === pKey;
  const hostEqual = !urlExact && rHost !== null && rHost === urlHost(page.Link);
  // On a shared platform, host equality is noise. Keep the signal visible to
  // the reader, but give it no weight.
  const sharedHost = hostEqual && isSharedHost(rHost);
  const hostSame = hostEqual && !sharedHost;

  if (urlExact) signals.push("url:exact");
  else if (hostSame) signals.push("url:same-host");
  else if (sharedHost) signals.push(`url:shared-platform(${rHost}, ignored)`);

  const sim = nameSimilarity(record.name, page.Name);
  if (sim >= NAME_STRONG) signals.push(`name:strong(${sim.toFixed(2)})`);
  else if (sim >= NAME_WEAK) signals.push(`name:weak(${sim.toFixed(2)})`);

  const rYear = yearOf(record.date.iso);
  const pYear = yearOf(page.d_start);
  const sameYear = rYear !== null && rYear === pYear;
  const gap = daysApart(record.date.iso, page.d_start);

  if (gap === 0) signals.push("date:same");
  else if (gap !== null && gap <= DATE_NEAR_DAYS)
    signals.push(`date:near(${gap}d)`);
  else if (sameYear) signals.push("date:same-year");
  else if (rYear && pYear) signals.push(`date:other-year(${pYear})`);

  // Series identity: the same conference, any year.
  const sameSeries = urlExact || hostSame || sim >= NAME_STRONG;
  // Instance identity: the same conference AND the same occurrence.
  const sameInstance =
    sameSeries && (gap === 0 || (gap !== null && gap <= DATE_NEAR_DAYS));

  let score = 0;
  if (urlExact) score += 50;
  else if (hostSame) score += 30;
  if (sim >= NAME_STRONG) score += 25;
  else if (sim >= NAME_WEAK) score += 10;
  if (gap === 0) score += 40;
  else if (gap !== null && gap <= DATE_NEAR_DAYS) score += 30;
  else if (sameYear) score += 15;

  return { page, signals, sameSeries, sameInstance, score };
};

/**
 * Classify a record against all candidate pages.
 *
 * Verdicts:
 *   `update`       — one page is the same instance. Update it in place.
 *   `create`       — nothing matches, or only other years of the same series
 *                    match. Create a new page.
 *   `ambiguous`    — more than one page looks like the same instance, or the
 *                    best candidates tie. **Ask Ryan; never pick.**
 *   `needs-review` — the record itself can't be matched safely (no website, no
 *                    parseable date).
 *
 * @returns {{verdict: string, why: string, best: object|null,
 *   candidates: object[], priorYears: object[]}}
 */
export const classify = (record, pages) => {
  const scored = pages
    .map((p) => scoreCandidate(record, p))
    .sort((a, b) => b.score - a.score);

  const instances = scored.filter((c) => c.sameInstance);
  const priorYears = scored.filter((c) => c.sameSeries && !c.sameInstance);

  if (!record.website && !record.date.iso) {
    return {
      verdict: "needs-review",
      why: "no Event website and no parseable start date — nothing safe to match on",
      best: null,
      candidates: scored,
      priorYears,
    };
  }

  if (instances.length === 1) {
    return {
      verdict: "update",
      why: `one existing page is the same instance (${instances[0].signals.join(", ")})`,
      best: instances[0],
      candidates: scored,
      priorYears,
    };
  }

  if (instances.length > 1) {
    return {
      verdict: "ambiguous",
      why: `${instances.length} pages look like the same instance — pick one`,
      best: null,
      candidates: instances,
      priorYears,
    };
  }

  // No instance match. If the series exists in other years, that is a strong
  // signal the record is a NEW instance — and a useful template to copy from.
  if (priorYears.length > 0) {
    return {
      verdict: "create",
      why:
        `series exists in ${priorYears.length} other year(s) but not this ` +
        `instance — create a new page (prior years are a good template)`,
      best: null,
      candidates: scored,
      priorYears,
    };
  }

  return {
    verdict: "create",
    why: "no candidate matched on url, name or date",
    best: null,
    candidates: scored,
    priorYears,
  };
};
