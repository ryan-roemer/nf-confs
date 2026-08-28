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

### 2026-08-28 — "processed" means `Speaking` is checked

**Situation:** the queue was defined as `Email/Slack Sent` unchecked, which is
Ryan's own downstream step. A fully-processed record therefore stayed in the
queue until he did manual comms — which is what made "Alfonso has two
unprocessed submissions" collide with three visible rows.

I proposed deriving processed-ness from the work products (Approvals row, Notion
page). **Ryan corrected the premise:** an event can need no leave and no budget,
so it never gets an Approvals row yet still must be processed.

**Decision (Ryan):** processed = **`Speaking` checked in `Speaking Events`**.
That is where the workflow ends.
**Rules:**

1. Queue = speaking engagement with `Speaking` unchecked. `Email/Slack Sent`
   drives nothing; it stays visible as information only.
2. **`Speaking` is written LAST** — after Notion, after any Approvals row. The
   model depends on it: set it earlier and a failed Notion write leaves a record
   marked done that isn't.
3. `needsBudget` follows **the ask** (`leave || travel || hotel`), not the
   engagement variant. The old rule would have appended an Approvals row with no
   money and no leave days for any plain `Speak…` entry that asked for nothing.

**Accepted cost:** `Speaking` may be ticked early by someone categorising an
entry, and the workflow would skip it silently. A miss, not corruption; runs are
supervised. An audit of `Speaking`-TRUE rows against Notion would catch it if it
becomes real.

**Effect:** queue drops from 5 to **3** — Ticino, Come To Code, DevFest Roma.
DevFest Campobasso and We Make Future are both `Speaking`-checked and correctly
drop out. Note this removes the only `update`-path entry (We Make Future) from
the work list, so that code path stays unexercised.

Also: `needsBudget` fell from 78 to 41 of 98 speaking rows. 38 of the difference
are plain `Speak…` entries with no ask, 20 of them 2024-era — those blanks
probably mean the form did not yet ask, rather than a deliberate no. All are
already done, so no operational impact, but do not read historical blanks as
intent.
**Status:** graduated.

### 2026-08-28 — money columns carry a currency format; type bare numbers

**Situation:** Q2 has been open since the layout was mapped — the money columns
render `€200`, `€70.00`, `€1,020`, and gviz returns the formatted value either
way, so it was impossible to tell whether the cells hold numbers with a currency
format or literal text.
**Settled by the first real write:** a typed `70` reads back as `€70`. The
columns carry the format.
**Rule:** type bare numbers into `Travel` / `Accomodations` / `Total`. Never type
a currency symbol. Verification must strip `€ £ $ ,` before comparing
numerically — the first run reported three false FAILs by comparing a typed
value against a formatted one, which is the verifier crying wolf on a write that
was actually correct.
**Status:** graduated.

### 2026-08-28 — the Approvals write must be idempotent

**Situation:** `--verify` recomputed `firstBlankRow` and checked row 15 — the
next append target — rather than row 14, which had just been written. That
exposed the real gap: the write path had no notion of "already recorded", so a
**rerun would have appended the same conference a second time**.
**Rule:** `findApprovalRow()` looks the record up by (email, conf) in the
`Approved` section first. Found → skip the append, report `ALREADY RECORDED`,
and verify against that row. Not found → append at the first blank.
**Status:** graduated. Not caught by the incident review — found only because a
verify-only rerun pointed at the wrong row.

### 2026-08-28 — preconditions flag and stop, and it worked immediately

**Situation:** Ryan: if the CDP session is not logged in or otherwise not ready,
flag it rather than fixing it. On the very first guarded `--apply`, the
precondition refused: the tab was still on a scratch workbook left over from the
guard test.
**Significance:** that is precisely the situation that caused the incident — a
correct address against the wrong workbook. Before the guards it would have
typed. It stopped and named the problem.
**Rule:** browser preconditions (signed out, wrong workbook, editor not loaded)
report what is wrong and what to do, and never self-heal. Also: clean up scratch
tabs, not just scratch files — trashing the file left the tab pointing at it.
**Status:** graduated.

### 2026-08-28 — INCIDENT: wrote into the wrong worksheet, corrupting live data

**What happened:** `sheet:write --apply` for DevFest Campobasso typed its
Approvals row into `Form Responses 1` row 14 — a 2024 submission — and wrote
`TRUE` over `L114` (`Objectives for the event:`). Ryan restored from undo;
verified 15/15 cells back to the pre-write snapshot.

**Mechanism:** two different row 14s. `2026 Approvals` row 14 was the correct
append target; `Form Responses 1` row 14 was a real record. The script addressed
the **cell** but treated the **worksheet as ambient state** — whatever tab was
selected. `selectTab()` used a synthetic `element.click()` inside
`Runtime.evaluate`; the Sheets tab strip is a Closure widget that listens for
real pointer events, so the click did nothing and the tab never switched. A
correct address then landed in the wrong coordinate space. Column L is the
`Speaking` checkbox on one tab and free-text objectives on the other.

**Why nothing caught it:**

- The script logged `wrote 2026 Approvals row 14` — that was intent, not outcome.
- Read-back verification looked only where the write was _supposed_ to go. It
  correctly reported FAILED, and was blind to where the keystrokes actually went.
- The synthetic click was introduced when Playwright was swapped for raw CDP.
  The scratch workbook it was validated on had **one tab**, so the only
  mechanism that broke was the one the test could not exercise — and the path
  was then reported as "proven".

**Rules:**

1. **Never overwrite a non-empty cell.** Every append target must read blank;
   a checkbox target must read exactly `TRUE` or `FALSE`. Anything else aborts.
   This alone would have prevented every byte of this damage.
2. **Address writes as (worksheet, cell), never as a cell plus ambient state.**
   Verify the active worksheet name from the DOM, and the Name Box contents,
   immediately before typing.
3. **Verify through the same path the write travels.** A gviz pre-read validates
   a different coordinate space than the keystrokes use, so it cannot catch a
   worksheet mismatch.
4. **One cell at a time: write, verify, continue.** A misdirected write then
   damages at most one cell.
5. **Never dispatch synthetic clicks at application chrome.** Use real input
   events and confirm the state change took effect.
6. **Test a mechanism on a fixture that contains its failure mode.** A
   multi-tab workbook, or the test proves nothing about tab switching.

**Remedy built, same day.** The Name Box turns out to accept a sheet-qualified
reference — `'2026 Approvals'!A14` switches worksheets by itself. That makes
worksheet+cell **one atomic address** and removes the failure mode at its root
rather than guarding against it. On top of that:

- `gotoCell(session, tab, ref)` verifies the active tab name AND the Name Box
  after navigating, and throws if either disagrees.
- `writeCell()` requires an explicit `allow` predicate for the cell's CURRENT
  content — no default. Approvals targets must be empty; the checkbox target
  must read exactly `TRUE` or `FALSE`.
- Identity is re-proved on the typing path (formula bar), not just via gviz —
  the two address different coordinate spaces.
- One cell at a time: write, read back, stop on the first mismatch.
- Independent gviz confirmation afterwards, as a second path.
- Preconditions (not signed in, wrong tab, editor not loaded) **flag and stop**
  for Ryan; the script never tries to fix them.

Incidentally confirmed the root cause while building the test fixture: a
synthetic click on the add-sheet button also did nothing, and the same click via
`Input.dispatchMouseEvent` worked. Synthetic clicks do not work on Sheets chrome.

**Verified on a MULTI-TAB scratch workbook — the fixture the original test
lacked — 8 of 8 guards pass**, including the incident scenario: a write on the
second worksheet did not leak onto the first.

**Status:** remedy built and tested. `sheet:write --apply` is safe to run again
under supervision.

### 2026-08-28 — `Location` follows favoured style, not the prior year

**Situation:** the sheet and the conference page both said `Campobasso, Italy`;
the 2025 sibling said `Campobasso - Italy`. Across 9 located DevFest rows, 7 use
`City, Italy` and 2 use `City - Italy`.
**Decision (Ryan):** `City, Italy` is the favoured style. **Do not retro-fix
existing rows.**
**Rule:** write `City, Country`. When a prior-year page in the same series uses
a different format, the favoured style wins — the prior year is a template for
_content_, not a licence to copy its formatting mistakes. Never edit historical
rows to match.
**Status:** graduated — resolves the "conference page vs prior year" question
for `Location`.

### 2026-08-28 — `Affliation` is the umbrella org, not the chapter

**Situation:** the conference page names **GDG Campobasso** as organiser.
`Affliation` is null on all 13 DevFest pages — the field is new-ish and has not
been filled historically.
**Decision (Ryan):** use **`GDG`** — the umbrella organisation is the better
affiliation than the specific local chapter. Explicitly flagged as often a
judgment call.
**Rule:** prefer the umbrella body (`GDG`, `Linux Foundation`, `CNCF`) over a
local chapter or city edition. It stays a judgment call — when the umbrella is
unclear, ask rather than guess.
**Status:** open — one instance. Watch whether "umbrella over chapter" holds on
a non-GDG event before treating it as settled.

### 2026-08-28 — record CFP dates whenever they are determinable

**Situation:** sessionize gave `CFP Opens 2026-07-15` and
`CFP Deadline 2026-08-15` — already closed. Every prior DevFest page has both
null, so I proposed matching the series and leaving them empty.
**Decision (Ryan):** **fill them in**, precisely so people can see the CFP is
closed. The historical nulls are a gap in attention, not a convention.
**Rule:** set `CFP Opens` and `CFP Deadline` whenever the CFP link yields them,
including for a CFP that has already closed. A closed CFP is useful information,
not noise.
**Status:** graduated.

**Lesson repeated:** this is the second time today a sparse fill rate was read
as intent and was wrong — `Date Approved` was the first. A field being mostly
empty is not evidence that it should stay empty. Ask.

### 2026-08-28 — three tune-ups from the first test run

**Situation:** the cold-session test surfaced three inconsistencies in the
instructions themselves, not in the data.
**Decision / fixes:**

1. `docs/plan.md` was stale — it listed `notion/match.js` as `[TODO]` when it was
   built and tested, and described the Approvals write as "appends to the first
   empty row", which is wrong for the sectioned tab. Tree rewritten against
   reality; the write path now states the section layout and the row-26 stop.
2. **The skill contradicted `workflow.md` on `Tags`.** Step 3 told the reader to
   copy `Tags` from the prior year; step 5 and `workflow.md` both say never touch
   it. The test session followed `workflow.md` and left it unset — the right
   call, but it should not have had to choose. Step 3 now excludes `Tags`
   explicitly.
3. `isDataRow` failing silently on the Approvals tabs — **already fixed** earlier
   the same day; `readTab` now throws and takes a per-tab predicate.

**Rule:** when two instruction files disagree, that is a bug in the instructions,
not a judgment call for the reader. `workflow.md` is the authority on field
mappings; the skill must not restate a mapping in a way that can drift from it.
**Status:** graduated.

### 2026-08-28 — never navigate a tab Ryan might be using

**Situation:** `pickTarget` returned the first `google.com` page target, which
could be an `accounts.google.com` tab. `write.js` then navigates whatever tab it
picked to the workbook.
**Decision:** prefer a tab already on a spreadsheet.
**Rule:** both CDP modules pick a `/spreadsheets/d/` tab when one exists.
**Status:** graduated.

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
