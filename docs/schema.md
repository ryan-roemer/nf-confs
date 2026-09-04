# Schema

What the two systems actually contain, from live reads — not from assumption.
Anything not yet verified says so.

## Notion: 📆 Events Calendar

**Verified 2026-08-28** via the Notion connector (`fetch` on the database).

- Workspace: Nearform (`5fb787ca-e149-48b6-9749-e76766785148`)
- Database page: `d2494cb4-4199-4b11-83a7-a2cca2640466`
- **Data source (the one to query/write):**
  `collection://28b11369-07e7-4e0a-819c-536fd577f5a2`
- Parent: **Nearform Events hub** (`8303407e-1dc4-448a-b418-ae17ff020390`),
  under "The Nearform Way"
- Supports SQLite queries via `query_data_sources`, so matching can be a real
  query rather than a full-table pull.

### Properties

| Property                    | Type         | Notes                                                                                                                                                                                                                    |
| --------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Name`                      | title        | The event name. Inconsistent across years — see matching.                                                                                                                                                                |
| `Date`                      | date         | Start, optional end, optional datetime.                                                                                                                                                                                  |
| `Who`                       | **person**   | **The speakers.** JSON array of real Notion user IDs.                                                                                                                                                                    |
| `Owner`                     | person       | Internal owner, distinct from speakers.                                                                                                                                                                                  |
| `Engagement`                | multi_select | `Host` · `Attend` · **`Speak`** · `Sponsor`                                                                                                                                                                              |
| `Status`                    | multi_select | `Passed` · `Suggested (speaker programme)` · `Confirmed` · `For Sales consideration` · `In review`                                                                                                                       |
| `Event Type`                | select       | `Conference` · **`CFP Deadline`** · `Meetup series` · `Networking` · `Internal` · `Client Showcase` · `Roundtable` · `Webinar` · `Awards` · `CXO Dinner` · `CXO Breakfast briefing` · `Hospitality` · `Panel discussion` |
| `Related / CFP`             | relation     | **Self-relation**, limit 1. Links an event to its CFP row.                                                                                                                                                               |
| `Link`                      | url          | Event URL. Best stable-key candidate.                                                                                                                                                                                    |
| `CFP Details`               | url          |                                                                                                                                                                                                                          |
| `CFP Opens`, `CFP Deadline` | date         |                                                                                                                                                                                                                          |
| `Location`                  | text         | Free text, very inconsistent (`Milan, Italy`, `Milan (Italy)`, `Milan - Italy`, `Online`).                                                                                                                               |
| `Region`                    | select       | `Americas` · `Europe` · `Remote` · `Global` — note `Asia` appears in row data but is **not** in the option list.                                                                                                         |
| `Audience`                  | multi_select | 24 options.                                                                                                                                                                                                              |
| `Tags`                      | multi_select | 44 options.                                                                                                                                                                                                              |
| `Organiser`                 | multi_select | `Sales` · `Marketing` · `Tech / Speaker Programme` · `Other`                                                                                                                                                             |
| `Affliation`                | text         | Spelled that way in Notion. Don't "fix" it in code.                                                                                                                                                                      |

### Three things this settles

1. **Speakers are real Notion users, not text.** `Who` takes user IDs, so
   assigning a speaker is a lookup (`get_users` by name/email → ID), not a fuzzy
   human-name match. Much more reliable than feared. The failure mode moves to
   "sheet spells the name differently than Notion does".
2. **A conference is often TWO pages.** `Event Type: CFP Deadline` rows are
   pseudo-events joined to the real event by `Related / CFP`. So "does this
   already exist" has to mean "does the _event_ row exist", and any dedupe pass
   must not treat a CFP row as the event or vice versa.
3. **There is no budget or cost property at all.** The nearest thing to approval
   state is `Status`. See the budget question in [plan.md](plan.md) — if spend
   needs tracking, this database currently cannot hold it.

### Relevant views

- **`Upcoming Speakers`** — `Who is not empty`, excludes `Internal`/`CFP
Deadline`, date ≥ today. Effectively the existing answer to "who is speaking
  where", and a good oracle to check our output against.
- `Events` / `Upcoming` / `CFPs` / `Tech (AI)` / `Tech (AI) - CFPs` /
  `Europe GTM` / `Europe GTM (Confirmed)` / `Calendar`

## Google Sheet: Event Speaking Program intake

**Counts last verified 2026-09-03** by exact per-tab `gviz` CSV read through the
signed-in conference Chrome (`npm run sheet:probe -- --save`), with the row-wise
repair pass on. This supersedes an earlier pass via the Drive connector, which
undercounted every tab.

⚠️ **These are a snapshot of a live workbook and go stale as submissions land.**
Read them as "the shape of each tab", not as current totals — the numbers below
moved between 2026-08-28 and 2026-09-03 and will move again. Anything that
depends on an exact count must read it live, not from here. The table is
date-stamped so a mismatch reads as staleness rather than as a broken read.

- File: `1kzqKVEthPZgV-NvE7P9GoAyKgEOHM1_cU7btRAsJMF8`
- Six tabs, all six read as distinct content.

| #   | Tab                                    | Lines | Real data rows          | Cols |
| --- | -------------------------------------- | ----- | ----------------------- | ---- |
| 0   | `Form Responses 1`                     | 118   | **113**                 | 47   |
| 1   | `Speaking Events`                      | 1694  | **113**                 | 33   |
| 2   | `2026 Approvals`                       | 19    | — (layout, not a table) | 15   |
| 3   | `2025 Approvals`                       | 24    | — (layout, not a table) | 15   |
| 4   | `Detailed Approval Records [Form:uKs]` | 1     | **0** (header only)     | 69   |
| 5   | `Swag Requests`                        | 12    | 7                       | 28   |

"Real data rows" counts rows carrying an email, which is the pipeline's own test
for a real row — `Speaking Events` has formulas dragged ~1600 rows past the data
(see the traps below), so a non-empty-line count is meaningless there.

### `Speaking Events` mirrors `Form Responses 1` row for row

113 of 113 rows align on (`Email Address`, `Name of the Event or Conference`),
re-verified 2026-09-03.

⛔ **That pair aligns the two tabs; it is NOT a unique key.** The same person
resubmits the same conference — Dario Scanferlato has **two** `Ticino Data
Conference 2026` rows (2026-07-07 and 2026-08-24), differing in engagement,
start date, website and cost. Joining anything on `(email, name)` silently
collapses them and maps one row's values onto the other. **Join by position**
within the email-bearing subsequence, which is what both tabs are ordered by,
and what `probe.js`'s repair pass and `records.js`'s mirror check use. A join on
that pair produced a wrong 85-cell drop count on 2026-09-03; the real figure was 35. If a row must be addressed individually, the `Timestamp` in column 0
distinguishes resubmissions.

Four rows hold the start date in different _formats_ (`17/10/2026` vs
`2026-10-17`) but **zero disagree in meaning** — an earlier note here claimed a
disagreement and was wrong. Ryan norms toward ISO by hand over time, which is
why the formats diverge without the dates diverging.

That makes the twin an **independent witness on the date**: where the form still
holds `DD/MM/YYYY`, the twin is often already ISO. `resolveDate()` uses it, and
across the live sheet it confirms 106 rows outright and cuts the
typographically-ambiguous set from 3 to 1 (row 109, `09/11/2026`, where the twin
is also ambiguous). Columns 0–5 are identical in both (timestamp, email, event name,
start date, duration, location), which is the signature of an ARRAYFORMULA
mirror. The workflow columns sit alongside it:

| #     | Column                                                                                                                            | Note                                      |
| ----- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| 0–5   | `Timestamp` · `Email Address` · `Name of the Event or Conference` · `Event start date` · `Event duration (in days)` · `Location ` | mirrored from the form — **do not write** |
| 6–9   | `Travel Y/N` · `Hotel Y/N` · `Leave Y/N` · `Swag Y/N`                                                                             | what was asked for                        |
| 10    | **`Funded`**                                                                                                                      |                                           |
| 11    | **`Speaking`**                                                                                                                    |                                           |
| 12    | **`Email/Slack Sent`**                                                                                                            |                                           |
| 13–17 | `Where` · `TravelPerk` · `Expensify` · `Leave Days` · `Notes`                                                                     | costs and logistics                       |
| 18    | resources/budget (mirrored form question)                                                                                         |                                           |
| 19–23 | `Travel` · `Hotel` · `Leave` · `Swag` · `Location`                                                                                | derived booleans + resolved location      |

Note the trailing-space in `Location ` at index 5, distinct from `Location` at
index 23. Match column names exactly; do not trim.

Consequence for writing: the mirrored columns are formula output and must never
be written to. Only the hand-maintained workflow columns are writable, addressed
by row index.

### Three traps this tab sets

**1. Row count. `Speaking Events` has 1694 non-empty lines and 112 real rows.**
Rows 116–1693 are pre-dragged formulas emitting `N,N,N,FALSE,FALSE` forever. Any
"is this a data row" test must look for an actual email or event name — a
non-empty-cell test yields 1,578 phantom rows.

**2. Headers. gviz drops the header of any column it types as date or number.**
Fetching a whole column makes gviz infer a type from the data, and a text header
it cannot coerce comes back empty — 20 of `Speaking Events`' 33 headers vanish
this way, including `Timestamp`, `Event start date`, `Event duration`,
`Speaking`, `Email/Slack Sent`, `TravelPerk`, `Expensify` and `Leave Days`,
i.e. most of the workflow state we care about. Fix: read the header from a
single-row range (`range=A1:ZZ1`), where every cell is a string, and splice it
over the body's first line. `scripts/sheet/probe.js` does this, and the saved
files then show all 24 of `Speaking Events`' real columns (indices 0–23; 24–32
are empty trailing columns).

**2b. The same typing deletes BODY cells, not just headers — and this one costs
money.** Verified 2026-09-03. Type inference is per column over the requested
range, so in a mostly-numeric column every **text** cell is discarded and comes
back **blank**. A dropped cell is byte-identical to an empty one, so a cost
estimate that was given reads downstream as _nothing was requested_.

Measured live: **35 cells** across the workbook, 113/113 rows paired — 7 travel
estimates, 8 accommodation estimates, 16 attendee counts, 4 TravelPerk/Expensify
values. The deleted cost values include `£100`, `£150`, `£200`, `£400`, `£130`,
`£0` — **currency conversions, which are Ryan's alone** — and
`<100 EUR (if allowed to use my own car)`.

Fix: the same single-row-range trick as the headers, applied per row.
`probe.js` re-reads every email-bearing row as `range=A<n>:ZZ<n>` and fills
blanks from it, pairing **positionally** over email-bearing rows — `(email,
name)` is _not_ a key, because the same person resubmits the same conference
(Dario Scanferlato has two `Ticino Data Conference 2026` rows). A count mismatch
abstains and says so. Every run prints the recovered count; `--no-repair` opts
out and warns that a dropped cost then looks empty.

**Never calibrate a parser on `.data/` CSVs produced without the repair pass** —
the GBP values were absent from an earlier calibration that concluded "no value
is in another currency".

**3. And a trap in tab addressing.** The tab strip's DOM `data-id` is not the
worksheet gid — it returns ordinals (4, 41, 51) — and gviz answers an
unrecognised `gid` by returning the _first_ tab instead of erroring. The first
probe run therefore reported "6 of 6 tabs read successfully" while having read
tab 1 six times. Select by tab name, and fingerprint each response so identical
content is reported as a failure rather than a success.

### `Form Responses 1` coverage

Of 112 data rows: **112 carry an email**, **112 carry an `Event website`**. Three
further lines have partial content and no email — treat as incomplete rows, not
as data. 64 distinct website hosts across the 112.

### Tabs 2 and 3 are sectioned layouts, not tables

This matters for writing, so here is the real structure of `2026 Approvals`:

| Row  | Content                                                                                                                            |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 1    | headers — `Email` · `Conf` · `Date` · `Travel` · `Accomodations` · `Total` · `Actuals` · `Leave Days` · (spacer) · `Date Approved` |
| 2    | **column totals** (€1,020 · €1,565 · €2,365 · · 8)                                                                                 |
| 3    | the label `Approved`                                                                                                               |
| 4–12 | 9 data rows                                                                                                                        |
| 13   | the label `In consideration`                                                                                                       |

⚠️ **"Append to the first empty row" is wrong** and would file an approved
entry under `In consideration`. A write has to find the section boundary, and
growing the `Approved` section may need a **row insert** — which the Name Box
path cannot do. Unresolved; see the open questions in [plan.md](plan.md).

`2025 Approvals` shares the shape but leads with `Name` where 2026 leads with
`Email`. Totals: 2025 = €5,610 across 20 confs / 12 leave days; 2026 = €2,365
across 9 confs / 8 leave days.

Observed conventions in the 9 existing 2026 rows:

- `Leave Days` is `1` where leave was requested and **blank** where it wasn't —
  never `0`.
- `Actuals` is empty in all 9.
- `Date Approved` is filled in 1 of 9.
- Currency rendering is inconsistent: `€200`, `€70.00`, `€1,020`. Whether that
  is cell formatting over a bare number or typed text **cannot be told from
  gviz**, which returns the formatted value either way.
- `Total` is hand-entered and does not always equal travel + accommodation —
  row 11 has accommodation €200 with total €250, and row 12 has €70.00 + €300.00
  with total €250.

### `readTab` needs the right predicate per tab

The Approvals tabs put the email in **column 0**; `Form Responses 1` and
`Speaking Events` put it in column 1 with the event name in column 2. The
default `isDataRow` predicate therefore matches nothing on Approvals. It used to
return zero rows silently — indistinguishable from an empty tab — and now throws
instead.

### Tab 4 is empty

`Detailed Approval Records [Form:uKs]` has its 69 columns and **zero rows** — an
approvals add-on that is wired up but unused, or has been cleared.

## What the two sides share, and don't

Two joins are exact, which is better than expected:

| Purpose                 | Sheet                              | Notion                                      | Quality                                                |
| ----------------------- | ---------------------------------- | ------------------------------------------- | ------------------------------------------------------ |
| Identity of the event   | `Event website` (URL)              | `Link` (url)                                | **Exact** — a real stable key, no name fuzzing         |
| Identity of the speaker | `Email Address`                    | `Who` (person → user ID)                    | **Exact** — email → Notion user via `get_users`        |
| Event name              | `Name of the Event or Conference`  | `Name` (title)                              | Fuzzy; use as a fallback/confirmation only             |
| Date                    | `Event start date` + duration      | `Date` (start/end)                          | Derivable — duration maps to the range end             |
| CFP                     | `Event Call for Papers (CFP) link` | `CFP Details` + the `CFP Deadline` twin row | Structural mismatch, see below                         |
| Engagement              | `Proposed engagement:`             | `Engagement` (multi_select)                 | Needs a value map                                      |
| Category / Audience     | `Event Category`, `Audience:`      | `Tags`, `Audience`                          | Needs a value map; Notion's lists are long and curated |

**And the part that does not overlap at all: budget and approvals.** Everything
about money, leave, travel, expensing and sign-off lives in the sheet (Tabs
B–E). The Notion Events Calendar has **no cost, budget, or approver property**;
its only sign-off-shaped field is `Status`. So these are two separate concerns
sharing one intake form, not one pipeline. See [plan.md](plan.md).

## Why the pipeline should not read sheets through the Drive connector

The Drive connector reads a spreadsheet and returned real, usable data — this
document is built from it. But it returns a prose/markdown rendering, and on
these files it:

- concatenated separate tabs into one stream with **no tab names or gids**,
- dropped column headers where the sheet has spacer columns, so indices shift,
- mangled non-ASCII (`Nearfest Europe 🇪🇺` → `Nearfest Europe ðªðº`),
- escaped content (`#NaN` → `\#NaN`, `#REF!` → `\#REF\!`), which would corrupt
  any exact comparison,
- exceeded the tool's token cap on the real sheet, needing a spill to disk.

Fine for discovery. Not a basis for cell-exact reconciliation, and it cannot
even tell us which tab is which. The `gviz` CSV read over CDP returns exact
per-tab cell values and stays the pipeline's path.
