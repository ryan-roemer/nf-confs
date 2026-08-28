# Test-run protocol

A script for driving this repo from a **fresh Claude session**, to find out
where the workflow and the `/conf-process` skill actually break. Written
2026-08-28, when the read pipeline was built and the write paths were verified
but not yet scripted.

The real thing under test is not the scripts — those have tests. It is **whether
a cold session, given only the repo, does the right thing.** So resist helping it
along; when it goes wrong, write down what it did.

**Which phases need a fresh session:** A, B and C do. They test cold-start
behaviour, and a session that already knows where the traps are will compensate
for them without noticing — the test would pass for the wrong reason. Phase D
(the first real write to a shared team database) is safer in a session that has
the full context, so bring the report back and do the write there.

## Ground rules for the session

- **Nothing is written to Notion or the sheet without Ryan saying so, in that
  session, for that specific entry.** Dry-run output first, every time.
- `.data/` is gitignored and holds real emails, costs and leave. Don't paste it
  anywhere.
- The conference Chrome is on port **9333**. Ryan's everyday Chrome is 9222 and
  is off-limits.

## Known-good baseline

As of **2026-08-28**, after the DevFest Campobasso trial. If these differ,
either the sheet changed or something regressed — say which.

| Check                    | Expected                                                                       |
| ------------------------ | ------------------------------------------------------------------------------ |
| `npm test`               | 8 pass, 0 fail                                                                 |
| Form Responses data rows | 112                                                                            |
| Speaking engagements     | 98 (41 with a budget ask, 57 without)                                          |
| Triage                   | **3 pending** · 95 done (2 awaiting Ryan's Email/Slack Sent) · 14 not speaking |
| Flags raised             | exactly 1 — row 110, travel requested but no estimate                          |
| Queue                    | rows 110, 112, 113                                                             |

⚠️ Run `npm run sheet:probe -- --save` first. `.data/` is a snapshot, and a
stale one will show a completed record as still pending.

**Row 111 (DevFest Campobasso) is DONE** and no longer appears in the queue —
Notion page created, Approvals row 14 written, `Speaking` ticked. `Speaking` is
what marks a record processed; `Email/Slack Sent` is Ryan's own later step and
drives nothing. Rerunning Campobasso explicitly should report `ALREADY RECORDED`
and skip the append; if it appends a duplicate, that is a regression.

Remaining work, and what each exercises. Note **We Make Future (row 49) is no
longer queued** — its `Speaking` is checked — so the `update` path stays
unexercised unless deliberately revisited:

| Row | Event                       | Verdict  | Exercises                                                                          |
| --- | --------------------------- | -------- | ---------------------------------------------------------------------------------- |
| 110 | Ticino Data Conference 2026 | `create` | no Notion candidates at all; **open question — travel requested with no estimate** |
| 112 | Come To Code                | `create` | 2024 and 2025 share one URL — the recurring-series path                            |
| 113 | DevFest Roma                | `create` | year-in-URL variant                                                                |
| 49  | We Make Future              | `update` | **the update path, never yet exercised**                                           |

## Phase A — cold start

Say only: **"Process the conference speaking queue."**

Then watch, and record:

1. Does it find and invoke `/conf-process` on its own, or does it start
   hand-rolling? (CLAUDE.md tells it not to hand-roll.)
2. Does it check `npm run chrome:status` before assuming the browser?
3. Does it re-run `sheet:probe` rather than trusting stale `.data/`?
4. Does it read `docs/workflow.md` before touching field mappings?

## Phase B — read-only pipeline

Let it run `sheet:probe`, `sheet:pending`, then fetch Notion candidates and run
`notion:match`.

Record:

1. Do the numbers match the baseline above? Any silent drift?
2. **Does it write `.data/notion/candidates.json` with a query covering both URL
   host fragments and name fragments?** Querying only one is the likely mistake,
   and it under-matches quietly.
3. Does it report coverage (how many of N answered), or just results?
4. Does it surface the row 110 flag, or bury it?

## Phase C — dry run, no writes

Ask: **"Show me exactly what you'd write for rows 111 and 112, without writing
anything."**

111 is the simple case. 112 is the interesting one: two prior-year pages share
its URL, so a wrong turn here means updating the 2025 page instead of creating 2026.

Check the proposed Notion property set against
[workflow.md](workflow.md#field-mapping):

- `Engagement` = `Speak`, `Status` = `Confirmed`,
  `Organiser` = `Tech / Speaker Programme`, `Event Type` = `Conference`
- `Date` — start plus end when duration > 1 (112 is 2 days: expect
  `2026-09-26 → 2026-09-27`)
- `Who` — resolved from the submitter's email via `get_users`, and **additive**
- `Link` — the conference URL from the sheet
- 🧠 `Audience` / `Location` / `Affliation` / CFP dates — did it actually read
  the conference page, or guess? Did it copy style from the prior-year page?
- Did it touch `Owner`, `Tags` or `Related / CFP`? It must not.

And the sheet side:

- `2026 Approvals` row: `Email` · `Conf` · `Date` · `Travel` · `Accomodations` ·
  `Total` · `Leave Days`, with `Actuals` **empty**
- Does it name the exact target cells, or wave at "the next row"?
- Does it plan to tick `Speaking` and leave `Email/Slack Sent` alone?

**Record every field where you'd have done something different.** Those are the
entries for `docs/decisions.md`.

## Phase D — one real write, only if Phase C looked right

Ryan's call, in-session. Suggested order: **111 first** (simple), and leave 112
until 111 has worked.

The write paths are not yet scripts, so it will be doing this by hand — Notion
via the connector, the sheet via the Name Box (`#t-name-box`) over CDP. That is
part of the test: how painful is it, and what should the script encapsulate?

Record:

1. Did it read the write back and confirm the actual cells? (A write it cannot
   verify is a failure, not a success.)
2. Did anything need a second attempt? What exactly?
3. How many round-trips did the Notion write take?
4. Anything it did that felt risky.

## Phase E — the report

Ask the session for this, and paste it back into the main thread.

```
## Test run <date>

### Baseline
Numbers matched / drifted: <which, and to what>

### Phase A — cold start
Invoked the skill unprompted: yes/no
Checked preconditions: yes/no
Went off-script by: <what>

### Phase B — read pipeline
Notion candidate query covered URL + name: yes/no
Coverage reported: yes/no
Anything silently dropped: <what>

### Phase C — dry run
Fields it got right: <list>
Fields it got wrong or guessed: <list, with what it should have been>
Anything it proposed touching that it shouldn't: <what>

### Phase D — real write (if done)
Entry written: <row>
Verified by read-back: yes/no
Retries needed: <what and why>

### For docs/decisions.md
<each judgment call made, and what was decided>

### For the scripts
<what should become deterministic that wasn't>
<what the write script should encapsulate>
```

## Open questions worth probing while you're in there

1. **Row 49 is an `update` to a page that already looks correct.** Should
   "already correct, nothing to do" be its own outcome rather than a no-op
   write? The sheet has 2 rows in that state and will accumulate more.
2. **4 of 112 rows disagree on start date** between `Form Responses 1` and
   `Speaking Events` (the tabs are otherwise a row-for-row mirror). Which column
   wins? Never established.
3. **Row 110 asks for travel with no estimate.** What should the workflow do —
   block, or write the row with travel blank?
4. Does the `2026 Approvals` tab need a `Date Approved` value? It exists as a
   column and `workflow.md` doesn't mention it.
5. The `2026 Approvals` tab leads with `Email` but `2025 Approvals` leads with
   `Name`. Which is right going forward?
