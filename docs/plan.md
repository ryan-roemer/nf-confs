# Plan: sheet → Notion events hub

Status: **design + open questions.** Nothing here is settled except the Chrome
launcher, which is built. This document is the thing we revise as we experiment.

## The job

|        | Google Sheet                             | Notion events hub                        |
| ------ | ---------------------------------------- | ---------------------------------------- |
| Role   | intake — conference info as it arrives   | record — conferences we have speakers at |
| Shape  | rows, one per conference (TODO: confirm) | database pages, one per event            |
| Access | read via authenticated CSV endpoint      | read + **write**                         |

The manual loop to shrink:

1. Review the sheet for **unprocessed** entries.
2. Add each to the events hub **if it doesn't already exist**.
3. Mark **which employees are speakers**.

Three hard parts, none of them the plumbing: deciding what "unprocessed" means,
deciding what "already exists" means, and resolving a name in a spreadsheet cell
to a person in Notion.

## Architecture

```
scripts/
  chrome.js            CLI: launch / status the dedicated Chrome     [BUILT]
  shared/
    cdp.js             connect, diagnostics, host guards             [BUILT]
    state.js           local cache of what we've seen and done       [TODO]
  sheet/
    read.js            fetch the conference sheet as CSV             [TODO]
    normalize.js       raw rows -> canonical event records           [TODO]
  notion/
    client.js          read the events hub, create/update pages      [TODO]
    match.js           canonical record <-> existing page            [TODO]
  sync.js              the pipeline: read, diff, plan, apply         [TODO]
data/
  events.json          snapshot of the last reconciled state         [TODO]
docs/
  schema.md            the real sheet columns and Notion properties   [TODO]
```

Stages are separate files on purpose. Reading the sheet, deciding what's new,
and writing to Notion have very different risk profiles, and the middle one is
where all the judgment lives — it should be inspectable and testable without a
browser attached.

### Reading the sheet — settled approach

Google Sheets serves any tab as CSV from its `gviz` endpoint, and a `fetch` from
inside a signed-in page carries the session cookies:

```
https://docs.google.com/spreadsheets/d/<KEY>/gviz/tq?tqx=out:csv&sheet=<TAB>
```

One authenticated request in page context, no API credentials, no OAuth app, no
scraping the grid DOM. This is proven — it's how `aine-nf-data` reads its
workbook headers. Note the endpoint is **read-only**; writing back to the sheet
means driving the real UI, which is a much bigger commitment (see Q1).

### Writing to Notion — the fork worth deciding first

**Option A: official Notion API with an internal integration token.**
Create an internal integration in the Notion workspace settings, share the
events hub database with it, put the token in `.env`. Then everything is a
documented REST call: query the database with filters, create pages with typed
properties, resolve people by user ID.

**Option B: drive the Notion web UI over CDP.**
No token, no admin involvement — but every property edit becomes a click on a
React surface with no stable selectors, relation pickers are modal typeaheads,
and a Notion release can break it silently on a write path.

**Option C (new, and now the likely answer): the Notion connector already
authorized in Claude sessions.** Verified live on the Nearform workspace —
`create_pages`, `update_page`, `get_users` and SQL `query_data_sources` all
report available, with no token and no admin step. The catch is real, though: a
connector exists only while a Claude session is running it. It is not available
to an unattended `node scripts/sync.js` on a cron. So Option C makes this a task
you hand to Claude, not a script you run.

**Recommendation: A if this must run unattended, C if it doesn't.** Option B is the right call for reading Google
Sheets because the CSV endpoint hands us a clean data format; there is no
equivalent for Notion writes. Automating a UI to create records in a live team
database trades a one-time admin ask for permanent brittleness on exactly the
operation we least want to be brittle. Worth noting the Chrome launcher is not
wasted either way — the sheet read needs it regardless.

If A is blocked (workspace policy, no admin rights), say so and we design B with
dry-run-by-default and a hard row cap per run.

Given the shape of the work — review a handful of new form rows, judge the
ambiguous ones, assign speakers — a human-in-the-loop session fits it better
than a cron job, and C costs nothing to start. A is the upgrade path if this ever
needs to run on its own.

## Open questions

Most of the original five were answered by reading both systems — see
[schema.md](schema.md). What survives:

**Q1. What does "unprocessed" mean — funded, or in Notion?** These turned out to
be different axes. The tracking tab already carries sheet-side workflow state
(`Funded`, `Speaking`, `Email/Slack Sent`), but none of it says whether the event
reached the Events Calendar. Two readings:

- _"Not yet actioned in the program"_ — driven by the tracking tab's own flags.
- _"Not yet in Notion"_ — derived by joining `Event website` → Notion `Link`.

Leaning: derive Notion presence by the URL join (needs no sheet writes,
self-heals, always current) and treat the tracking flags as a separate,
sheet-owned concern. Confirm which one you actually mean.

**Q2. Which tab is `gid=1701569290`, and what are the tab names?** The Drive
read cannot see tab names or gids, and `gviz` needs one or the other. One
signed-in read settles it.

**Q3. Does an event with no `Event website` happen?** The URL join is the whole
matching strategy, so rows missing it need a rule — fall back to name + date, or
flag for review. Worth a count before deciding.

**Q4. Should budget and approval data reach Notion at all?** The framing was
budget and approval management, but the two systems don't overlap there: money,
leave, travel, expensing and the three named approvers live only in the sheet;
the Events Calendar has no cost, budget or approver property, only `Status`.
Three ways to go:

- _Leave it in the sheet._ Notion gets events + speakers, which is what the
  Events Calendar is for. Simplest, and matches how each system is already used.
- _Add properties to Notion_ (Budget, Approval Status, Approvers) and sync them.
  Makes Notion the single view, but it's a schema change to a shared team
  database — other people's views depend on it.
- _Report separately._ Leave both schemas alone and generate the
  "what have we committed / what's pending" rollup from the sheet, which already
  has per-person budget tabs doing this by hand.

Leaning: the third for the budget question, the first for the sync. But this is
your call and it's the one that decides how much of the project exists.

**Q5. How do the value maps work?** `Proposed engagement:` → `Engagement`,
`Event Category` → `Tags`, `Audience:` → `Audience`. Notion's option lists are
long and curated (44 tags, 24 audiences); the form's are free-ish. These need a
lookup table you approve, not a guess — and unmapped values should fail loudly
rather than get dropped.

## Phases

Each phase ends at something runnable, with a checkpoint for you.

- **Phase 0 — access. [DONE]** Dedicated Chrome, launcher, status that reports
  which required hosts have tabs.
- **Phase 1 — see both worlds. [MOSTLY DONE]** Both schemas read live and
  written up in [schema.md](schema.md): six sheet tabs read exactly via `gviz`
  (`npm run sheet:probe -- --save`), and the Events Calendar's full property set.
  Still open: dump the Notion rows themselves and check how many of the 112 sheet
  websites already appear as a Notion `Link`. _Checkpoint: you confirm the schema
  doc matches reality — especially the 4 rows where the two big tabs disagree on
  start date._
- **Phase 2 — normalize and match, offline.** Sheet rows → canonical records;
  match against a saved Notion snapshot. Output a report: N rows read, N matched,
  N new, N ambiguous. No writes at all. _Checkpoint: you check the report's
  verdicts by hand — especially the ambiguous ones._
- **Phase 3 — write, dry-run first.** `sync --dry-run` prints the exact pages and
  properties it would create. Then real writes behind an explicit flag, with a
  row cap. _Checkpoint: one real page, created and inspected, before any batch._
- **Phase 4 — speakers, then budgets.** Speaker assignment on top of matched
  events. Budget/approval fields once Q4 is answered.

## Decisions on the record

- **Separate Chrome on port 9333, profile `~/.nf-confs/chrome-profile`.** Chrome
  enables the debug port only on a fresh process per user-data-dir, so a second
  profile is the only way to keep the everyday Chrome (9222) usable. Automation
  with write access to a team Notion workspace also shouldn't run in a browser
  full of unrelated signed-in tabs.
- **No session restore on that profile.** Playwright's `connectOverCDP`
  auto-attaches to every target and waits for each, so accumulated tabs blow the
  connect budget and produce a misleading "can't connect" error. A clean relaunch
  is the documented fix.
- **`cdp.js` names three connect failures apart, and heals one.** They are
  indistinguishable in Playwright's own error text but have different fixes:
  nothing listening, too many targets, and **no windows open**. The third is the
  one that will actually bite: closing the last tab does not quit a Chrome with
  remote debugging on, so the port stays live, `/json/list` drops to zero, and
  `connectOverCDP` fails with `Protocol error (Browser.setDownloadBehavior):
Browser context management is not supported` — which names neither cause nor
  fix. Verified by closing the last page target on a scratch profile and
  reproducing it, and by hitting it for real on the first live run.
  `PUT /json/new?about:blank` restores it, so `ensureWindow()` heals in place
  rather than sending anyone off to click.
