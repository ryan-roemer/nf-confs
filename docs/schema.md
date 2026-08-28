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

**Verified 2026-08-28** by exact per-tab `gviz` CSV read through the signed-in
conference Chrome (`npm run sheet:probe -- --save`). This supersedes an earlier
pass via the Drive connector, which undercounted every tab.

- File: `1kzqKVEthPZgV-NvE7P9GoAyKgEOHM1_cU7btRAsJMF8`
- Six tabs, all six read as distinct content.

| #   | Tab                                    | Lines | Real data rows          | Cols |
| --- | -------------------------------------- | ----- | ----------------------- | ---- |
| 0   | `Form Responses 1`                     | 116   | **112**                 | 47   |
| 1   | `Speaking Events`                      | 1694  | **112**                 | 33   |
| 2   | `2026 Approvals`                       | 13    | — (layout, not a table) | 15   |
| 3   | `2025 Approvals`                       | 24    | — (layout, not a table) | 15   |
| 4   | `Detailed Approval Records [Form:uKs]` | 1     | **0** (header only)     | 69   |
| 5   | `Swag Requests`                        | 8     | 7                       | 28   |

### `Speaking Events` mirrors `Form Responses 1` row for row

112 of 112 rows align on (`Email Address`, `Name of the Event or Conference`);
108 of 112 also agree on start date, so **4 rows disagree on the date** and are
worth a look. Columns 0–5 are identical in both (timestamp, email, event name,
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

### Two traps this tab sets

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

### Tabs 2 and 3 are layouts, not tables

`2025 Approvals` and `2026 Approvals` share a shape but not their headers —
2025 leads with `Name`, 2026 with `Email` — and interleave totals and an
`Approved` marker with the data rather than presenting a clean header row.
Totals: 2025 = €5,610 across 20 confs / 12 leave days; 2026 = €2,365 across
9 confs / 8 leave days. These need reading positionally, or by hand.

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
