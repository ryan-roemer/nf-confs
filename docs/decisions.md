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

### 2026-09-03 — the guest account is a migration, not an alternative (refines the entry below)

**Situation:** I had written the two-domain rule as "some people also have a
guest account". Ryan corrected the framing.

**Ryan:** many `@nearform.com` real users have been **deactivated in favour of**
a `@thenearformway.com` guest user, usually under the same name.

**Why the distinction matters:** it inverts the default. Under "alternative", a
miss on `@nearform.com` is an anomaly worth surfacing; under "migration", it is
the expected path for a growing share of speakers and surfacing it is noise. The
entry below treated my empty first lookup as a finding and cost Ryan two rounds
of correction — that is the cost of the weaker framing, and the reason this one
is recorded separately rather than folded into it.

**Rule:** expect the guest lookup to be the one that resolves. Report a
first-lookup miss as routine, not as a problem.
**Status:** graduated to `workflow.md` and `SKILL.md`.

**Tune-ups applied the same day**, all three at Ryan's request:

1. **`probe.js` never exited.** `connectToChrome` (Playwright `connectOverCDP`)
   holds the Node event loop open; the `finally` closed only the page. Every run
   wrote all six CSVs and then hung — it cost two timeouts and a killed job in
   one session, and made a working script look broken. Now disconnects the
   browser too. Over CDP that drops the client and leaves Ryan's Chrome alone,
   confirmed by reconnecting afterwards.
2. **The Approvals-skip line named the wrong reason.** It printed
   `skipped — "without requesting support or swag"`, but `needsBudget` reads the
   three ask columns, not the engagement variant. A plain `Speak at an event
representing Nearform` row asking for nothing would have been reported under
   a variant it isn't. Now states the fact the decision was made on: leave,
   travel and hotel all "no".
3. **`CdpSession.activate()`**, called first thing in the write path. Fronts the
   workbook tab so a throttled background tab cannot make `gotoCell` miss its
   wait. **Advisory, never fatal** — it prints a note if it cannot confirm, and
   the worksheet guard remains the thing that actually protects the write. The
   600 ms wait in `gotoCell` is deliberately untouched.

### 2026-09-03 — speakers have a second email domain, and guests are invisible to `get_users`

**Situation:** Saskatchewan Startup Summit (row 114 / sheet row 117),
adam.barrett@nearform.com. `get_users` returned **nothing** for that email, for
`Barrett`, for `adam.barrett`, and for the user id on his own 2025 Prairie Dev
Con page. A control lookup (Antonio Perrone, same call, by id) resolved fine, so
the call itself was working.

**I drew the wrong conclusion and said so out loud:** I reported the account as
**deactivated**. It is not.

**Ryan's correction:** people have a second Notion identity,
`FIRST.LAST@thenearformway.com`, and those are **guest** accounts. Adam has one.
`get_users` does not return guests — not by email, not by surname, not by id. So
an empty result is not evidence of absence, and I should have said "cannot see"
rather than "does not exist".

**Decision (Ryan):** check `FIRST.LAST@nearform.com` first, then
`FIRST.LAST@thenearformway.com`. He also asked whether the Notion **web** UI
could do the name matching, since the dropdown shows guests.

**Rule:** two-domain lookup, and when the id belongs to a guest, name it with a
live read — render a page that already carries it in the conference Chrome and
read the `Who` chip. Confirmed here twice: Prairie Dev Con rendered
`Who → Adam Barrett`, tying `143d872b-594c-814f-8e67-000217353431` to a human,
and the new page rendered the same name after the write. That is the only name
match available for a guest; Ryan confirms before writing one you could not name.

**Generalisable, and the part worth keeping:** a tool that cannot see a class of
records must not be read as proof that the record is missing. `get_users`
abstains on guests, and abstention is not a zero — the same rule CLAUDE.md
already states for counted evidence, applied to identity lookups.

**Applied:** page created, all 13 properties verified on read-back, exactly one
page (no duplicate from the failed first attempt). `Speaking` L117 TRUE,
verified on both paths. No Approvals row — nothing was requested.
**Status:** graduated to `workflow.md` ("`Who`: two email domains") and
`SKILL.md` step 5.

### 2026-09-03 — the worksheet guard fires when the Sheets tab is backgrounded

**Situation:** the first `--apply` on Saskatchewan Startup Summit refused:
`asked for worksheet "Speaking Events" but the active tab is "Form Responses 1".
Navigation did not take.` Nothing was written.

**Cause:** mine. I had driven the **Notion** tab in the same Chrome window to do
the guest name match, which left the Sheets tab in the background. Sheets
throttles a backgrounded tab, so the Name Box navigation did not complete inside
`gotoCell`'s 600 ms wait, and the guard correctly refused.

**Fix, and what not to do:** activate the spreadsheet tab first —
`curl -s http://127.0.0.1:9333/json/activate/<targetId>` — then rerun. The
retry wrote first try, no FAILs, verified on both paths. **Do not lengthen the
600 ms wait to make this go away**; the guard is the 2026-08-28
wrong-worksheet protection and the timeout is what makes it bite.

**Rule:** if this workflow drives any other tab in the conference Chrome, bring
the workbook tab back to the front before a sheet write. A retry after a
navigation refusal is safe by construction — the guard refuses rather than
writing — but it is still a refusal to report, not to skip past.
**Status:** open — worth a precondition in `write.js` that activates the
workbook target before `gotoCell`, if it recurs.

**Also seen, minor:** `notion-create-pages` rejected
`"date:Date:is_datetime": "0"` (string) with a 400 and the message
`wrote 0 instead of "0"`. It reads like a coercion notice but it is a hard
rejection — pass the bare number `0`. I confirmed no page was created before
retrying, rather than trusting the wording.

### 2026-08-28 — a ticked `Speaking` is not proof the Approvals row was written

**Situation:** Ryan spotted that Tomas Tormo's `Kubecon NA 2026 - AI Inference +
Agentic track` (row 112) had `Speaking` **and** `Email/Slack Sent` both ticked,
but no row in `2026 Approvals` — a €1,460 ask (travel 800 / hotel 660 / leave 1)
that never got recorded. He had simply missed the entry.

Audited six places for this record. `Speaking Events` marks, the Notion page,
`2025 Approvals` and `Detailed Approval Records` were all correct or correctly
absent; `2026 Approvals` and the `Swag Requests` tab were the two gaps.

**The blocker:** `sheet:write` selects from `queueOf()` — `Speaking` unchecked —
so the record was unreachable by the very tool that should write its row. Every
guard downstream already handled the case correctly (`alreadyTicked` prints
"no-op", `findApprovalRow` prevents a duplicate). Only the selector refused.

**Decision (Ryan):** add the flag rather than hand-type the row.
**Rule:** `--backfill` widens the selection pool to `backfillOf()` — speaking
records already marked done. It changes _what can be selected_ and nothing else;
empty-cell, identity, one-cell-at-a-time and dual-path read-back all still
apply, and a ticked `Speaking` is reported as a no-op. Never the default. Without
the flag, a miss on an already-ticked record now prints a hint naming `--backfill`
instead of a bare "no queued record matches".

**I over-read the cause, and Ryan corrected it.** I framed this as the
"processed = `Speaking` checked" decision's accepted cost coming due, and
proposed a standing `sheet:audit` cross-checking `Speaking`-TRUE ∧ `needsBudget`
rows against the Approvals tabs.

**Ryan's correction:** it is not a hole in the model. This entry predates the
workflow being automated at all, and it was approved outside the normal path —
he **meant** to have it, and the backfill is catch-up on a one-off, not a leak
to be plugged. He does not expect it to repeat. He did find the "above normal"
flags useful (the €1,460 being the largest ask in the tab, the contested row 17).

**Decision (Ryan):** **do not build the audit.** Don't over-rotate on a catch-up
task.

**Evidence, for whoever revisits this:** I ran the cross-check once, read-only,
before he said not to build it. Of **33** rows that are `Speaking`-TRUE with a
budget ask and a 2025/2026 date, **32 matched an Approvals row and 1 did not** —
this one. Zero rows fell out for a missing year tab. Name matching was fuzzy
(substring both directions), which can produce a false pass but not a false miss,
so "1 missing" is solid and "32 matched" is an upper bound. That number is the
argument against the audit, not for it: the class has one member and it is now
closed.

**Generalisable rule, and the one actually worth keeping:** a single miss is not
evidence of a systemic gap. Measure the class before proposing machinery for it,
and when the count comes back at one, say so and stop. Flagging the anomalies
(unusual amounts, contested targets) is the durable value here; building a
detector for a closed one-off is not.

**Applied:** `2026 Approvals` row 17, 11/11 cells verified on both paths, first
try, no FAILs. `Speaking` no-op as predicted.
**Status:** graduated to `scripts/sheet/write.js` (`--backfill`) and
`scripts/sheet/lib/records.js` (`backfillOf`). Audit **declined** — closed, not
open.

### 2026-08-28 — `Date Approved` switched from UTC to local (2nd occurrence)

**Situation:** the Kubecon backfill dry run stamped `2026-08-29` while Ryan's
local date was 2026-08-28 — the same ~17:00-Pacific UTC rollover logged earlier
today against Alfonso's two entries.

**Decision:** the earlier entry's own instruction was _"if it comes up again,
switch to a local-date computation rather than asking a third time."_ It came up
again, so I switched it without asking and told Ryan what changed before he
approved the write. `today()` now builds `YYYY-MM-DD` from local getters.
Confirmed on the Ticino dry run (`2026-08-28`, was `2026-08-29`) and on the live
Kubecon write.

**Rule:** `Date Approved` is Ryan's local date, never UTC.
**Meta-rule, and the one worth keeping:** a "watch for the 2nd/3rd occurrence"
note in this log is a **standing instruction, not a reminder to ask again**. When
the counter runs out, act on it in the same session and report the change. That
is the whole mechanism by which this file trades inference for certainty.
**Status:** graduated to `scripts/sheet/write.js`. ⚠️ This makes the UTC warning
in `workflow.md` (Stage 2, step 5) factually wrong — flagged to Ryan, not edited.

### 2026-08-28 — the post-write verifier races the gviz cache on the checkbox

**Situation:** the Come To Code `--apply` typed all 8 cells successfully, then
its own independent read-back reported `FAIL Speaking Events!L115 = "FALSE"`
and told me to treat the write as failed. The ten `2026 Approvals` cells in the
**same** read-back pass all verified. A `--verify` rerun seconds later returned
`ok Speaking Events!L115 = "TRUE"` — 11/11.

**Diagnosis:** not a bad write. The gviz endpoint had not yet propagated the
checkbox toggle when the read-back fired. The Approvals cells were typed first
and had a head start; `Speaking` is written last by design, so it is always the
freshest cell and always the one most likely to be read stale.

**Why it matters:** this is the verifier crying wolf a second time (the first was
`€`-formatted money, already fixed). A false FAIL on the _processed marker_
specifically is the expensive one — it invites a rerun or a manual "fix" of a
cell that was already correct.

**Rule:** a failing read-back on `Speaking` alone, where every Approvals cell
passed, means **re-verify before believing it**. Never re-type the checkbox on
the strength of one failed read. Candidate fix: have the verifier retry the
`Speaking` cell once after a short delay before declaring FAIL.
**Status:** open — 1st occurrence, no code change made.

### 2026-08-28 — `Date Approved` is stamped in UTC, not local

**Situation:** the dry runs for both of Alfonso's entries showed
`J  Date Approved  "2026-08-29"` while Ryan's local date was 2026-08-28. The
write ran at ~17:00 PDT, and `write.js:89` computes the value as
`new Date().toISOString().slice(0, 10)` — UTC, which had already rolled over.
Every approval written after ~17:00 Pacific gets tomorrow's date.

**Decision (Ryan):** apply as-is with 2026-08-29; do not hold the writes and do
not patch the script for this run.
**Also noted:** `Date Approved` (column J) is written by the script but does
**not** appear in the `workflow.md` Approvals mapping table, which stops at
`Leave Days` / `Actuals`. The doc and the code disagree about the column set.
**Rule:** none yet — Ryan accepted the UTC value once. If it comes up again,
switch to a local-date computation rather than asking a third time.
**Status:** ✅ **RESOLVED** later the same day — it came up again on the Kubecon
backfill and `today()` was switched to local getters. See the entry above. The
`workflow.md` UTC warning this entry describes has been rewritten to match.

### 2026-08-28 — Alfonso's two 2026 entries accepted at the amounts asked

**Situation:** rows 112 (Come To Code, 2026-09-26→27, Pignola) and 113 (DevFest
Roma, 2026-10-10) — both `alfonso.graziano@nearform.com`, both submitted
26/08/2026, both leave=no. Come To Code asks travel 60 / hotel 100 / total 160;
DevFest Roma asks travel 100 / hotel 170 / total 270. Every figure is a bare
number — the form captures no currency symbol.

I flagged two things rather than deciding them: (a) the missing currency, and
(b) DevFest Roma being a **1-day** event asking 170 of accommodation with 3h
travel each way — inside the "up to 2 nights, use common sense" wording, but the
one figure worth a second look.

**Decision (Ryan):** process **both**, at the amounts asked, figures read as
**EUR**.
**Rule:** one-off on the amounts. On currency: the form has no currency field, so
bare numbers on an EU-located event are not self-evidently EUR and the workflow
must keep surfacing it — but this is the 1st time it has been asked. Watch for
the 3rd.
**Status:** open.

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
