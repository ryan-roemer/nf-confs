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

### 2026-09-03 — gviz silently deleted 35 cells, and I reported one as "not given"

**This is the worst class of bug this repo can have, so it gets the long entry.**

**Situation:** Ticino Data Conference 2026 (row 110, Dario Scanferlato). I
reported "travel requested but **no estimate given**" and asked Ryan for the
figure from scratch. Ryan already knew the answer was there:
`<100 EUR (if allowed to use my own car)`.

**Cause — not a parser bug, a _reader_ bug.** `probe.js` read each tab as one
whole-tab gviz request. **gviz infers a column type from the data in the
requested range and DISCARDS every cell it cannot coerce, returning blank.** The
travel-cost column is mostly bare numbers, so gviz typed it `number` and deleted
the text value before any parser saw it. `probe.js` already knew this — it reads
the _header_ as a single-row range with a comment explaining exactly this
behaviour — and nobody applied the same reasoning one line down to the body.

**Why it is the worst class:** a dropped cost estimate is byte-identical to an
empty one. `classifyCost` returned `{empty: true, needsRyan: false}`, which the
workflow reads as _nothing was requested_. So the failure mode is a silent
downgrade of "ask Ryan" into "no ask" — the exact inversion of the ⛔ rule — on
money. Two of the deleted values were **`£100` and `£150`**: currency
conversions, which are Ryan's alone, reported as blanks.

**Fix:** `fetchRowsIndividually` + `repairDroppedCells` in `probe.js`. After the
whole-tab read, every email-bearing row is re-read as a single-row range and
blank cells are filled from it. Default on; `--no-repair` opts out and prints a
warning that a dropped cost now looks empty. Verified live: **113/113 rows
paired on both main tabs, 35 cells recovered** (travel 7, hotel 8, attendee
counts 16, TravelPerk/Expensify 4).

**Pairing is positional, and that detail matters.** My first blast-radius
measurement joined live rows to saved rows on `(email, name)` and reported
**85** dropped cells. That number was wrong. Dario has **two** `Ticino Data
Conference 2026` rows, so `(email, name)` is not a key — the map collapsed them
and diffed row 108 against row 113, inventing drops that were really
collisions. The real figure is 35. Position within the email-bearing
subsequence is the only stable join, and a count mismatch now abstains rather
than guesses.

**Rules, and these are the durable part:**

1. **A read that can silently drop data must be able to say so.** Every probe
   run now prints the recovered count and names the tabs it could not repair.
   `Recovered 0 cells` and `NOT REPAIRED` are different statements and must
   look different.
2. **Never calibrate a parser on data from a lossy reader.** `classifyCost`
   carried the comment "51 non-empty values … none is in another currency". It
   was measured on already-degraded CSVs; the `£` values had been deleted before
   they were counted. The docstring now says so, so nobody re-derives it.
3. **An identity join needs a real key.** Confirm uniqueness before joining on
   one, or join by position.

**Status:** graduated to `scripts/sheet/probe.js` and `scripts/sheet/lib/rows.js`.

### 2026-09-03 — `CFP Details` only when the CFP is actually open

**Situation:** Ticino's sessionize link existed only on the superseded July
submission. I had left `CFP Details` blank under the "newer entry wins, don't
carry values across" rule and asked.

**Decision (Ryan):** _"If sessionize link indicates CFP is open, then include,
otherwise omit."_

**Applied:** fetched <https://sessionize.com/ticino-data-conference-2026/> —
_"Call for Speakers is closed. Submissions are no longer possible."_ So
**omitted**. Note the trap: the organiser's own blurb further down still reads
"The call for speakers is open until July 31st, 2026", which is stale prose, not
status. Read Sessionize's **status banner**, not the description.

`CFP Opens` / `CFP Deadline` left blank on the same logic — a closed CFP on a
confirmed speaking record carries no useful date.

**Rule:** a CFP link is included only when the CFP is open on a live read of it.
This generalises past Sessionize: check the status, not the copy.
**Status:** open — promote to `workflow.md` if it holds a third time.

**Ticino outcome:** Notion page created (`3d19aa50dea281028168c3a9b38659da`),
**exactly one**, all 12 properties verified on an independent read-back, with
`Owner`, `Tags`, `Related / CFP` and all three CFP fields confirmed null. Sheet:
`2026 Approvals` row 19 and `Speaking` L113 — **11/11 cells verified on both
paths, first try, no FAILs**. `Link` is `https://tconf.ch/en/` at Ryan's
instruction. Travel €100 supplied via the new `--travel-eur` flag, which had
refused the run without it.

### 2026-09-03 — my CDP driving was the real failure, not CDP

**Ryan:** _"the CDP **would** have worked but you kept mucking up the tabs and
ability to even use CDP. That's my concern. The API is the better choice here,
but you should have been able to do CDP."_

He is right, and the four errors were all mine, all avoidable:

1. **Wrong target, never asserted.** `requireHostTab(/docs\.google\.com$/)` then
   `pages[0]` — which was a Google **Docs** tab, not the spreadsheet. The
   in-page `fetch` then failed as a bare `TypeError: Failed to fetch`, which
   reads like a network or auth fault and is really "wrong tab". `pickTarget`
   in `cdp-eval.js` already guarded this by preferring `/spreadsheets/d/`;
   `requireHostTab` does not, and its JSDoc did not say so.
2. **I blocked my own navigation.** `await response.text()` inside a
   `page.on("response")` handler during `goto` stalls the navigation. I read the
   resulting 90s timeout as "Notion is slow".
3. **Guessed selectors.** `input[placeholder*="search"]` on Notion, which
   renders no such element. Never queried first to see what was there.
4. **A 60-iteration scroll loop that never checked it was scrolling.** It moved
   the wrong container, collected 37 emails, and reported a confident zero.

**The common fault is the one worth keeping:** I never verified a target or a
selector before using it, and when a step failed I rewrote the script instead of
diagnosing the failure. Re-running a call that structurally cannot answer is not
persistence.

**Fix:** `requirePage(browser, {hostRe, urlIncludes, what})` in `cdp.js` —
selects a page by what it actually holds, and **throws with the tab listing**
when the match is empty or not unique rather than guessing. Its doc comment
carries the other three footguns. Demonstrated on the live browser: of 3
host-matched tabs, `pages[0]` was the Docs tab and `requirePage` returned the
workbook, after which the in-page gviz fetch returned row 113 at HTTP 200.

**Rule:** never take `pages[0]`. Match on the document, assert uniqueness, and
prove a loop is doing something before iterating.
**Status:** graduated to `scripts/shared/cdp.js` (`requirePage`).

### 2026-09-03 — speaker lookup is `search`, not `get_users` (supersedes the two entries below)

**Situation:** Ticino / Dario Scanferlato. `get_users` returned nothing for
`dario.scanferlato@nearform.com`, `@thenearformway.com`, `Scanferlato`, `Dario`,
`Ruben`, the full display name, and its own unfiltered `page_size: 100` listing —
where he belongs alphabetically between "Danny Hunn" and "Darko Pranjic". A
control member resolved on the same call. I reported it as blocked and asked
Ryan for the id.

**Ryan's correction:** _"His email **is** dario.scanferlato@thenearformway.com
for guests NFW. You should have found that."_ He pointed at the Notion people
directory, where guests are visible once the members-only filter is off.

**The actual answer, and it is one call:**

```
search(query: "dario.scanferlato@nearform.com", query_type: "user")
  → user://351d872b-594c-8174-9038-00027f076330
    "Dario Ruben Scanferlato"  dario.scanferlato@thenearformway.com
```

`notion-search` with `query_type: "user"` **sees guests**, and it maps the
sheet's `@nearform.com` address onto the guest account by itself. A bare
surname works too. It returns id, display name and true email in one shot, so it
is the confirmation step as well as the lookup.

**What I did wrong, and it is the part worth keeping.** I had already been told
the guest domain, and instead of reaching for a different _tool_ I re-ran the
same failing one with more query spellings, then spent four attempts scraping
the directory over CDP — which cannot work: the page is Notion-managed
(`restricted_resource` to `fetch`), virtualised in the browser, and
members-filtered by default. Ryan called it mid-task: _"you're doing the same
thing over and over."_ He was right, and the tell was there after lookup two.

**Rules:**

1. **Use `search` + `query_type: "user"` for every speaker lookup.** One call,
   the sheet's email as-is. `get_users` is not for this and never was.
2. **Two failures of the same call is the signal to change tool, not query.**
   Re-running a call that structurally cannot answer is not persistence.
3. **Don't scrape a Notion-managed surface**, and never change a shared view's
   filter to read something — that edits what the whole team sees.

**Status:** graduated to `workflow.md` ("`Who`: look speakers up with `search`")
and `SKILL.md` step 5. **Supersedes** the 2026-09-03 two-domain entry and the
guest-name-by-rendered-chip workaround below — those described a constraint that
only existed because the wrong tool was being used.

### 2026-09-03 — the write path was accepting budgets on Ryan's behalf

**Situation:** found by running the Ticino dry run right after teaching
`classifyCost` about hedged figures. `approvalCells` wrote
`record.ask.travelCost.amount` straight into column D, so the new hint of `100`
from `<100 EUR (if allowed to use my own car)` appeared as the approved Travel
figure — while `F Total` stayed **blank**, because `ask.total` is null whenever
either side needs Ryan. A filled Travel beside an empty Total, from a number
Ryan had never approved.

It happened to match the €100 he chose, which is exactly what makes it worth
logging: the output was right and the mechanism was wrong.

**Fix:** `resolveCost` + `unresolvedCosts` in `write.js`. A cost with
`needsRyan` is never written from the parser's reading — the run **refuses, dry
run included**, naming the raw value, the reason, and the flag. `--travel-eur N`
/ `--hotel-eur N` supply the figure, mirroring `--leave-days`. `Total` is now
derived from the figures actually being written.

**Rules:**

1. **Refuse on the dry run too.** The dry run is what Ryan approves from, so a
   figure he never supplied appearing there is the same error one step earlier.
2. **A parsed hint must never become a default.** It is printed as "reads as
   100, but that is a hint, not a price".
3. **The tool enforces the ⛔ rules, not my diligence.** Four things are Ryan's
   alone; two of them are cost figures, and the script now makes them
   unwritable without him.

**Status:** graduated to `scripts/sheet/write.js` and `SKILL.md` step 6.

### 2026-09-03 — a hedged figure is Ryan's call, not a number to accept

**Situation:** the recovered value was `<100 EUR (if allowed to use my own
car)` — a conditional maximum, not a price.

**Decision (Ryan):** "let's just call it 100 EURO".

**Rule:** `classifyCost` now recognises **hedges** — a bound (`<100`, `up to
80`, `max`), an approximation (`~`, `about`, `around`), a range (`100-150`,
`80 / 100`), or a condition (`if`, `depends`) — and sets `needsRyan` **even when
a clean number falls out**, carrying the number only as a stated starting point.
Accepting a budget is Ryan's, so a hedge must never self-resolve. It also
recognises an explicit **decline** (`I don't need it, I'll be online`,
`Online event`, `N/A`) as a real 0 rather than a stop, which is the opposite
error and just as worth avoiding: 4 cells, previously 2 false stops.

A malformed number like `1.500,50` deliberately reports **no** hint — a wrong
number beside a warning invites a glance instead of a read.
**Status:** graduated to `scripts/sheet/lib/rows.js`.

### 2026-09-03 — the same person submitted the same conference twice

**Situation:** Dario submitted Ticino Data Conference 2026 on **7 Jul** as
"Suggest an event for Nearform to **sponsor**" (start 17/10/2026, travel `120`)
and again on **24 Aug** as "**Speak** at an event" (start 30/10/2026). They
disagreed on the date, the website and the cost. Only the second is in the queue,
because the first is not a speaking engagement.

**Decision (Ryan):** **the newer entry wins.** He expects this to be
"incredibly rare".

**Rule:** later submission supersedes earlier for the same speaker + conference.
Report the older one so he can see what changed; do **not** carry values across
from it — the `120` in the July row is not evidence for the August row's cost.
**Do not build duplicate detection** — same lesson as the 2026-08-28 audit
entry: measure the class before building machinery for it, and this class has
one member. Report it when the queue surfaces it, nothing more.

**The conference page settled the date**, per the step-4 rule that `Link` beats
the sheet: <https://tconf.ch/en/> states "30 October 2026" four times. Sheet and
page agreed, so no ⛔ escalation.
**Status:** one-off — no rule beyond "newer wins".

### 2026-09-03 — missing Line Manager / Technical Director

**Situation:** Dario's form named only **Rob Harber**, in the _Head of Delivery_
slot. Line Manager and Technical Director were blank — and the form asks for the
line manager specifically when leave is requested. I re-read the row cell-by-cell
to confirm the blanks were real and not the gviz drop above.

**Decision (Ryan):** flagging it was right; **Rob alone is sufficient here.**
**Rule:** flag missing approver slots, never infer who fills them. Whether one
named approver suffices is Ryan's call each time.
**Status:** open — promote if it recurs a third time.

### 2026-09-03 — new step 7: the speaker email

**Situation:** Ryan asked for a copy-pasteable raw markdown email to send the
speaker, offered as an option rather than produced every time — he sends it for
some entries and not others.

**Decision (Ryan):** added to `SKILL.md` as **step 7**, with his template
verbatim and explicit fill rules for the three budget variants (travel + hotel /
travel only / hotel only / neither, which drops the TravelPerk paragraph
entirely), the no-leave case, and empty supervisor slots.

**Rule:** offer it, never assume it. **Never invent an email address** — the form
gives supervisor names only, so an unknown address is written
`Name <ADDRESS TO CONFIRM>`. Requests in the speaker's `Additional comments:`
(Dario asked for feedback on his presentation) are not covered by the template
and go to Ryan separately.
**Status:** graduated to `SKILL.md` step 7.

### 2026-09-03 — a "graduated" entry in this log was not actually in the code

**Situation:** the tune-up note below records that `pending.js`'s Approvals-skip
line was fixed to state the fact the decision was made on. The code still read
`ask none — "without requesting support or swag"`. The fix had been described
here but never landed.

**Rule:** this log records what Ryan decided; it is **not** evidence about the
current state of the code. Verify a "graduated" claim against the file before
relying on it — as CLAUDE.md already says about stated facts that no longer
match the repo. Fixed now, with the reasoning in a comment beside the line so it
does not regress a third time.
**Status:** graduated to `scripts/sheet/pending.js`.

### 2026-09-03 — `--leave-days`: recording leave the form never captured

**Situation:** Adam Barrett's Saskatchewan Startup Summit submission answered
"without requesting support or swag" with leave/travel/hotel all **no**, and was
already fully processed. Ryan then said Adam is taking **1 day of event leave**
and wanted it in `2026 Approvals` — with the original submission left exactly as
it stands.

**The gap:** `needsBudget` reads the three ask columns, all of which say no, so
the Approvals block was unreachable. The new fact exists nowhere in the sheet.

**Decision:** follow the `--backfill` precedent from earlier today — **add the
flag rather than hand-type the row**. Hand-typing would bypass the empty-cell
check, the identity check, one-cell-at-a-time writing, the label boundary, the
idempotency check and the dual read-back, which is exactly the class of thing
the 2026-08-28 incident produced.

**Rule:** `--leave-days N` is Ryan supplying a fact the form cannot carry, the
same shape as him supplying a EUR conversion. It forces an Approvals row when
`needsBudget` is false, and **only** the leave count — it never invents money.
`--leave-days 0` is not a request and conjures nothing. The override is printed
next to what the form actually said, so it can never be applied quietly.

**Second time "add the flag, don't hand-type" has been the answer** (after
`--backfill`). One more and it should be written into `workflow.md` as the
standing rule for this path rather than decided case by case.

**Bug found on the way, and it would have shipped a wrong number:**
`approvalCells` computed `Total` from `ask.total`, which is **0** — not null —
when nothing was requested. The write filter keeps `0`, so a leave-only row
would have typed `0` into the currency-formatted `Total` column and rendered
**€0**. Every hand-written leave-only row in the tab (Alfonso's `Jsday`,
`CloudConf`) leaves Travel/Accomodations/Total blank. It never fired before
because every script-written row so far carried both travel and hotel. Fixed:
no cost on either side means Total is blank.

**Applied:** `2026 Approvals` row 18, 11/11 cells verified on both paths, first
try, no FAILs. Rerun reports `ALREADY RECORDED`. `Speaking` no-op as expected.
**Status:** graduated to `scripts/sheet/write.js` (`--leave-days`, `Total` fix).

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
