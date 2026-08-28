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
  chrome.js            CLI: launch / status / login the Chrome       [BUILT]
  shared/
    cdp.js             connect, diagnostics, window heal, guards     [BUILT]
  sheet/
    probe.js           exact per-tab gviz read -> .data/sheet/*.csv  [BUILT]
    pending.js         Stage 1 triage + ask summary                  [BUILT]
    lib/rows.js        CSV parse, date/cost/checkbox semantics        [BUILT]
    write.js           append Approvals row, tick Speaking           [TODO]
  notion/
    snapshot.js        dump the Events Calendar to .data/notion/     [TODO]
    match.js           sheet record <-> existing page, by URL        [TODO]
config/
  targets.json         sheet key, Notion database + data source      [BUILT]
.data/                 gitignored: emails, costs, leave              [BUILT]
docs/
  workflow.md          the authority on field mappings               [BUILT]
  schema.md            what both systems actually contain            [BUILT]
  plan.md              this file
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
means driving the real UI — see below, where that is now verified working.

### Writing to Notion — settled: the authorized connector

Verified live on the Nearform workspace: `create_pages`, `update_page`,
`get_users` and SQL `query_data_sources` all report available. These are real
API calls with typed properties — a `people` property takes user IDs, a
`multi_select` takes option names, a `date` takes a start/end range. No token to
provision, no admin step, no UI automation.

Two consequences worth being explicit about:

- **A connector only exists while a Claude session is running it.** There is no
  unattended `node scripts/sync.js` on a cron with this design. That suits a
  workflow whose core step is Ryan deciding whether to fund something.
- **If it ever must run unattended**, the upgrade is an internal Notion
  integration token: same REST semantics, so the plan doesn't change shape.

### Writing to Google Sheets — settled: drive the real UI over CDP

`gviz` is read-only, so writes need the UI. **Verified working 2026-08-28** by a
spike against a throwaway workbook (created, written, read back, trashed):

The **Name Box** — the cell-reference input left of the formula bar — is a
single stable input, `#t-name-box` (class `waffle-name-box`). That avoids ever
clicking a cell in the virtualised grid:

1. Focus `#t-name-box`, type the target reference (`A2`), press Enter. The grid
   selection moves there.
2. Type the value, press Tab to move right, repeat across the row.
3. Press Enter to commit.

The spike wrote a header row, a data row (`a.person@nearform.com`,
`Come To Code`, `2026-09-26`, `160`) and a literal `FALSE` into a checkbox cell,
then confirmed all of it through a `gviz` read-back.

Why this is acceptable rather than merely expedient:

- **The write surface is two operations, not general automation.** Append one
  row of 7 cells to `2026 Approvals`, and set one checkbox in `Speaking Events`.
  Both address cells by reference, which is exactly what the Name Box does.
- **Every write is verifiable.** `gviz` reads the same cells straight back, so
  the pipeline can confirm what landed instead of assuming. Any write step that
  cannot read back its own result should fail.
- **Nothing is overwritten blind.** The Approvals write appends to the first
  empty row; the checkbox write targets one known cell.

Caveat found in the same spike: the read-back showed the `Date` and `Total`
_headers_ as empty, because gviz types a column from its data and drops a text
header it cannot coerce. The values in the data row were correct. Verify writes
by reading the **cells**, not the header row.

## Open questions

Answered so far, and by what: see [decisions.md](decisions.md). What remains,
in the order it blocks work.

**Q1. Where does an approved row go in `2026 Approvals`?** The tab is
sectioned — totals at row 2, the label `Approved` at row 3, data at 4–12, the
label `In consideration` at row 13. So "append to the first empty row" would
file an approved entry under the wrong heading. Options:

- Write into the last row of the `Approved` section, if there is a spare.
- **Insert** a row at the section boundary — which the Name Box write path
  cannot do; that needs a right-click row insert, or a different write path.
- Something else you already do by hand that isn't visible in the data.

This is the one blocking question for the sheet write script.

**Q2. Currency in the Approvals money columns.** Existing cells render `€200`,
`€70.00`, `€1,020` — inconsistent decimals in one column. gviz returns the
_formatted_ value, so it cannot tell us whether the cell holds a number with a
currency format or literal text. If it's formatting, the script types `150` and
the sheet does the rest; if it's text, the script types `€150`. One check in the
UI settles it.

**Q3. Does the script compute `Total`?** It is hand-entered today and already
inconsistent with travel + accommodation on 2 of 9 rows. Computing it would be
deterministic and would quietly correct history; preserving hand entry keeps the
sheet as the human record.

**Q4. Which wins when the conference page and the prior-year Notion page
disagree?** The first test run hit this on `Location`, `Audience` and
`Affliation` for **both** events it dry-ran. `workflow.md` says the conference
`Link` is the source of truth, but the prior-year page carries house style for
exactly these fields. A standing rule would remove three escalations per event.

**Q5. Should "already correct, nothing to do" be its own outcome?** Row 49 is an
`update` to a page that already looks right. Two rows are in that state today
and more will accumulate. A no-op write is noise; an explicit outcome is
information.

**Q6. Row 110 asks for travel with no estimate.** Block the entry, or write the
Approvals row with travel blank?

**Q7. `2026 Approvals` leads with `Email`, `2025 Approvals` with `Name`.** Which
is the going-forward shape?

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
