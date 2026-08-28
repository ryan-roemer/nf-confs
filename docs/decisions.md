# Decision log

Judgment calls Ryan made, so the workflow can stop asking about them. Append at
the top; never rewrite history.

The point of this file: **when the same decision recurs three times, it stops
being a judgment call and becomes a rule.** Promote it into
[workflow.md](workflow.md) as deterministic behaviour and note here that it
graduated. Inference traded for certainty.

Log failures too — a mis-parse, a confidently wrong match, a field that needed
re-doing. Those are the entries that actually improve the skill.

## Format

```
### YYYY-MM-DD — <short title>
**Situation:** what the workflow hit, with the specific row/event.
**Decision:** what Ryan said.
**Rule:** the generalisable version, or "one-off — no rule".
**Status:** open · recurring (2nd time) · graduated to workflow.md
```

## Entries

### 2026-08-28 — gviz collapses blank rows, so CSV position is not a sheet row

**Situation:** the write plan addressed cells by row number derived from CSV
position (`sheetRow = index + 2`). Checked against the live sheet: **4 of 5
queue rows were wrong, all off by 3**, because `Form Responses 1` holds 3 blank
rows that gviz drops. Writing the `Speaking` tick for DevFest Campobasso at the
derived row 111 would have ticked it on "Software Development Superstream" — a
different person's entry — and the read-back would have shown a successful write
to row 111.

Confirmed gviz drops blanks **even inside an explicit range**: `A1:J30` over the
Approvals tab returns 13 lines, not 30. So no full-tab read can ever report true
row numbers.

**Decision:** never write to a row number derived from CSV position.
**Rule:** `resolveSheetRow()` scans down from the CSV estimate (a lower bound —
blanks only push content down) and confirms email + event name before returning
a row. It throws rather than guessing. Verified on the live queue: offsets +0
and +3, 5 of 5 resolved. Reads that need row numbers use single-row ranges.
**Status:** graduated to `scripts/sheet/lib/rowmap.js`.

### 2026-08-28 — Playwright cannot attach reliably; use raw CDP for reads

**Situation:** `connectToChrome()` hung repeatedly with 11 targets open — below
our own 12-target warn threshold — because `connectOverCDP` auto-attaches to
every target and waits for each, and four of them were Notion SPAs.
**Decision:** reads do not need Playwright. A gviz fetch is one
`Runtime.evaluate` in one already-open tab.
**Rule:** `scripts/shared/cdp-eval.js` talks raw CDP for reads. Playwright stays
for driving the Sheets UI, where typing and key events are needed.
**Status:** graduated.

### 2026-08-28 — where an approved row goes, and `Date Approved`

**Situation:** I had documented "append to the first empty row", then found the
tab is sectioned and concluded a row _insert_ was needed — which the Name Box
write path cannot do. That framing was wrong.
**Decision (Ryan):** just add the next row down — `A14:H14`, then 15, 16, and so
on into the blank rows below the data. **`In consideration` sits at sheet row 26**,
and only when the data reaches it does it get moved further down, by hand.
Also `J<row>` = **`Date Approved`, set to the current date**. (Ryan is behind on
filling these historically — 1 of 9 rows — but the intent is to fill it.)
**Rule:** append to the first blank row after the last data row; never insert.
Write `A`–`F` and `H`, skip `G` (`Actuals`) by tabbing past it, and set `J` to
today's date. If the target row reaches 26, **stop and ask** — moving the
`In consideration` label is Ryan's call, not the script's.
**Status:** graduated — supersedes the earlier "leave `Date Approved` blank"
proposal below, which was inferred from the 1-of-9 fill rate and was wrong.

### 2026-08-28 — `readTab` returned a silent zero on the Approvals tabs

**Situation:** found in the first test run. `isDataRow` requires an email in
column 1 and a name in column 2 — the shape of the two form-backed tabs. The
Approvals tabs put the email in column 0, so the predicate matched nothing and
`readTab` returned an empty row list. Exactly the failure CLAUDE.md warns about:
a silent drop reading as a real zero.
**Decision:** a predicate that matches nothing in a non-empty file is an error,
not an empty result.
**Rule:** `readTab` throws, naming the header it actually found, and takes a
per-tab predicate.
**Status:** graduated to `scripts/sheet/lib/rows.js`.

### 2026-08-28 — the "4 rows disagree on start date" finding was wrong

**Situation:** I reported that 4 of 112 rows disagreed on start date between the
two mirrored tabs, and listed "which column wins?" as an open question. The test
run checked it properly: all 4 differ only in **format** (`17/10/2026` vs
`2026-10-17`). Zero semantic disagreements.
**Decision:** no conflict exists, so no precedence rule is needed. Better: the
twin is an independent witness, because Ryan norms toward ISO by hand so the twin
is often already unambiguous where the form isn't.
**Rule:** `resolveDate()` cross-checks the form date against its twin — agreement
confirms and resolves typographic ambiguity, an ISO twin that disagrees is a real
conflict to escalate. Cuts ambiguous rows from 3 to 1.
**Status:** graduated to `scripts/sheet/lib/rows.js`.

### 2026-08-28 — the mirror must be verified per row before any write

**Situation:** sheet writes are addressed by row index, and the row-for-row
mirror between the two tabs was only checked by row _count_. A slipped pairing
would tick `Speaking` on someone else's row.
**Decision:** verify identity (email + event name) per row, and refuse to write
if any row fails.
**Rule:** `loadRecords()` returns `mirrorOk`; `assertMirrorIntact()` must be
called before any sheet write. Currently 112/112 intact.
**Status:** graduated to `scripts/sheet/lib/records.js`.

### 2026-08-28 — `Leave Days` is blank, not zero, when no leave was requested

**Situation:** all 9 existing `2026 Approvals` rows map to their form rows; the
8 with `leave=YES` carry `1`, and the 1 with `leave=no` is blank. 9/9 coverage.
**Decision:** follow the existing convention.
**Rule:** leave requested → `1`; not requested → leave the cell blank.
**Status:** open — needs Ryan's confirmation, then goes into the write script.

### 2026-08-28 — `Date Approved` and `Actuals` in Approvals

**Situation:** `Actuals` is empty in all 9 rows (already established as Ryan's,
for later). `Date Approved` is filled in only 1 of 9.
**Decision:** proposed — write neither.
**Rule:** the write script never touches `Actuals` or `Date Approved`.
**Status:** ⚠️ **SUPERSEDED** 2026-08-28. `Actuals` stands — never written. But
`Date Approved` _should_ be written with the current date; the 1-of-9 fill rate
was a backlog, not a convention. A lesson about inferring rules from sparse
fill rates: absence of data is not evidence of intent.

### 2026-08-28 — `Speaking` is not a processed marker

**Situation:** the first triage used `Speaking` as the processed flag, which put
10 attend/sponsor rows in the queue and left 2 genuinely-pending rows out.
**Decision:** `Email/Slack Sent` is the only marker of "Ryan has processed
this". `Speaking` means "this is a speaking engagement" and may be ticked early
by someone else.
**Rule:** queue = `Email/Slack Sent` FALSE. Treat the `Speaking` tick in Stage 2
as idempotent.
**Status:** graduated to workflow.md.

### 2026-08-28 — any `Speak*` engagement counts as speaking

**Situation:** the spec named one engagement value; the data has two speaking
variants, the second being `…without requesting support or swag`, 20 rows.
**Decision:** match the `Speak` prefix — the form has grown suffixes and will
grow more. The no-support variant goes to the Events Calendar but skips the
Approvals write.
**Rule:** `/^\s*speak/i` is speaking; `/without requesting support/i` means no
budget.
**Status:** graduated to workflow.md.

### 2026-08-28 — bare cost numbers are EUR

**Situation:** the first pass flagged all 9 queued cost values as "currency
unclear", which is noise that trains us to ignore warnings.
**Decision:** calibrated against all 51 non-empty cost values in the workbook —
46 bare numbers, 5 explicit `€`, zero non-EUR ever. A bare number is EUR by this
form's convention.
**Rule:** only a foreign currency symbol/code, a mixed signal, or an unparseable
value stops the run and asks Ryan.
**Status:** graduated to `scripts/sheet/lib/rows.js`.
