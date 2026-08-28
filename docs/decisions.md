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
