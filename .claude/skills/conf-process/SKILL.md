---
name: conf-process
description: Process conference speaking requests from the Event Proposal Form sheet into the Notion Events Calendar — triage the queue, summarise each budget ask for Ryan's decision, write the Approvals row, and create or update the Events Calendar page. Use when Ryan asks to process conference entries, work the speaking queue, check for unprocessed conference requests, or add a speaker to the events hub.
---

# Processing conference speaking requests

[docs/workflow.md](../../../docs/workflow.md) is the authority on every field
mapping. Read it before touching a field this file doesn't spell out. Never
invent a mapping.

## The division of labour

Deterministic scripts decide everything that can be decided from data. You
decide nothing that a script can decide, and you never decide the things marked
⛔ below. Where judgment is needed, **ask Ryan and log the answer** (see
[Capturing decisions](#capturing-decisions)) — that log is how this workflow
gets better.

⛔ **Never automate, never infer, always ask:**

- Whether to accept a conference budget. This is Ryan's alone.
- Any currency conversion. Report the raw figure; Ryan supplies EUR.
- Which of two plausible Notion pages is the right one. `ambiguous` means ask.
- A conference link that differs wildly from the sheet — wrong year, wrong
  country, wrong event. Flag and stop.

## Step 0 — preconditions

```bash
npm run chrome:status          # must show Google + Notion tabs
npm run sheet:probe -- --save  # refresh .data/sheet/ from the live workbook
```

If Chrome isn't up or isn't signed in, `npm run chrome:login` and hand it to
Ryan. Do not proceed on stale `.data/`.

## Step 1 — triage

```bash
npm run sheet:pending
```

**The queue is a speaking engagement whose `Speaking` is unchecked.**
`Email/Slack Sent` is Ryan's own later step and drives nothing here. Report it to Ryan as-is: the ask
summary (leave / travel / hotel and the raw cost figures) is exactly what he
needs to make the call. Surface every ⚠️ line; do not filter them.

**Then stop and get his decision per entry.** Nothing below happens for an entry
he skips.

## Step 2 — fetch Notion candidates

Only a Claude session can reach Notion, so you are the transport. For the
queued entries, query the Events Calendar and write the result to
`.data/notion/candidates.json`.

Data source: `collection://28b11369-07e7-4e0a-819c-536fd577f5a2`

Query on URL host fragments **and** name fragments for every queued event — both,
because some organisers put the year in the URL and some don't:

```sql
SELECT url, "Name", "Link", "date:Date:start" AS d_start,
       "date:Date:end" AS d_end, "Event Type" AS etype, "Status",
       "Engagement", "Who", "Location", "Region", "Affliation",
       "Organiser", "Audience", "Tags", "CFP Details"
FROM "collection://28b11369-07e7-4e0a-819c-536fd577f5a2"
WHERE lower("Link") LIKE '%<host-fragment>%'
   OR lower("Name") LIKE '%<name-fragment>%'
ORDER BY d_start DESC
```

Write it as `{ fetchedAt, query, pages: [...] }` — the shape is documented at the
top of `scripts/notion/match.js`. Keep the raw values; the matcher parses the
JSON-string columns itself.

## Step 3 — match

```bash
npm run notion:match
```

Verdicts, and what each means:

- **`update`** — one page is the same instance. Update it in place.
- **`create`** — make a new page. When `priorYears` is non-empty, the series
  exists in other years: **copy from the most recent prior year** for `Audience`,
  `Location` style and `Region`, then override with this year's facts. This is
  why the matcher prints prior years. **Not `Tags`** — this workflow never sets
  `Tags`, even when the prior year has them (see step 5).
- **`ambiguous`** — ⛔ ask Ryan. Never pick.
- **`needs-review`** — ⛔ ask Ryan.

**A recurring conference reuses its URL**, so a URL match with a different year
is a _new instance_, not an update. The matcher already handles this; don't
second-guess it toward "update".

## Step 4 — read the conference page

For the 🧠 fields, fetch the conference URL and read it. `Link` is the source of
truth, above the sheet.

| Field                       | What to look for                                                       |
| --------------------------- | ---------------------------------------------------------------------- |
| `Affliation`                | organiser / parent foundation / community behind the event             |
| `CFP Opens`, `CFP Deadline` | often absent even when the CFP is open — leave blank rather than guess |
| `Audience`                  | refine the sheet's `Audience:` against Notion's option list            |
| `Location`                  | norm against the conference page **and** how existing rows are written |

If the page contradicts the sheet on year, country or identity — ⛔ stop and ask.

## Step 5 — write Notion

Set only these, and leave everything else alone:

| Property                                                                                   | Value                                                |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| `Link`                                                                                     | the conference URL                                   |
| `Date`                                                                                     | start, plus end when duration > 1                    |
| `Event Type`                                                                               | `Conference` (almost always)                         |
| `Engagement`                                                                               | `Speak`                                              |
| `Status`                                                                                   | `Confirmed`                                          |
| `Organiser`                                                                                | `Tech / Speaker Programme`                           |
| `Who`                                                                                      | **add** the speaker; look up by email — both domains |
| `Audience`, `Region`, `Location`, `Affliation`, `CFP Details`, `CFP Opens`, `CFP Deadline` | per steps 3–4                                        |

**Never touch** `Owner`, `Tags`, `Related / CFP`.

⚠️ **`Who` is additive.** Multiple speakers per event is normal. Read the
existing value, append, write the union. Removing a speaker is data loss.

**Look the speaker up with `search`, in ONE call:**

```
search(query: "<the sheet's email>", query_type: "user")
```

It returns the `user://` id, the true display name and the real email together.
It **sees guests**, and it resolves an `@nearform.com` address straight to the
person's `@thenearformway.com` guest account — so there is no second lookup and
no domain guessing. A bare surname works too.

⛔ **Do not use `get_users`, and do not scrape the people directory.**
`get_users` structurally cannot see guests — not by either email, surname, first
name, display name, user id, or in its unfiltered listing — and many speakers
exist _only_ as guests. The Notion people directory is Notion-managed
(`restricted_resource` to `fetch`), virtualised in the browser, and filtered to
members by default; scraping it finds nothing and changing its filter would
alter a view the whole team sees. Both were tried on 2026-09-03 and wasted a
long detour. Full rule: [workflow.md](../../../docs/workflow.md) → "`Who`: look
speakers up with `search`".

Confirm with Ryan only when the returned display name does not plainly match
the speaker on the sheet.

Show Ryan the exact property set before writing. On an `update`, show the
before/after for every field you're changing and flag any existing value that
disagrees with the sheet.

## Step 6 — write the sheet

Only for entries Ryan accepted, and only after Notion succeeded.

```bash
npm run sheet:write -- --event "<name>"           # dry run, always first
npm run sheet:write -- --event "<name>" --apply   # write
npm run sheet:write -- --event "<name>" --verify  # re-check an earlier write
```

Show Ryan the dry run and get an explicit go-ahead before `--apply`.

**`--backfill` when the record is already ticked.** Selection defaults to the
queue, so a record whose `Speaking` is already TRUE cannot be named — the run
exits with a hint rather than writing. That is correct for normal work: a ticked
row is done. But Ryan sometimes processes an entry by hand and misses a piece of
its sheet output, and then the Approvals row still has to be written. Add
`--backfill` to widen the pool to already-done records. It changes only what can
be selected — every guard still applies, and `Speaking` is reported as a no-op.
Never reach for it to get past a refusal you don't understand.

**Read [docs/decisions.md](../../../docs/decisions.md) before changing anything
in this path.** On 2026-08-28 a write landed in the wrong worksheet and
overwrote a live record. The guards below exist because of it — do not route
around them.

- **Writes address `'Tab Name'!A14` atomically.** The Name Box accepts a
  sheet-qualified reference and switches worksheets itself. Never click a
  worksheet tab; never let the active tab be ambient state. A cell reference is
  meaningless without its worksheet — column L is a checkbox on one tab and free
  text on another.
- **A cell is only written if its current content is what was expected.**
  Approvals targets must be empty; the checkbox must read exactly `TRUE`/`FALSE`.
- **Rows are resolved, never derived.** gviz collapses blank rows, so CSV
  position is not a sheet row — the live queue is off by 3.
- **Idempotent.** If the record is already in the `Approved` section it reports
  `ALREADY RECORDED` and skips the append. Reruns are safe.
- `G` (`Actuals`) and `M` (`Email/Slack Sent`) are **never** written. `M` is
  Ryan's, and it is what takes the record out of the queue.
- Appends stop at the `In consideration` label (row 26). If the section fills,
  **ask Ryan to move it** — never move it yourself.
- Money columns carry a currency format: **type bare numbers**, never `€`.
- **An Approvals row exists only when something was requested** (`leave`,
  `travel` or `hotel`). An event that asks for nothing gets no Approvals row at
  all, whichever engagement variant was chosen — its only sheet output is the
  `Speaking` tick.
- **`--leave-days N` when Ryan says leave was taken and the form doesn't know.**
  The form asks leave yes/no, so a speaker who answered "no" and then took event
  leave is invisible to every column here. That number is his to supply, like a
  EUR conversion — never infer it. It forces an Approvals row when `needsBudget`
  is false and sets **only** `Leave Days`; money columns stay blank. The run
  prints the override beside what the form said, so show him that before
  `--apply`. Pair it with `--backfill` if the record is already processed.
- **`--travel-eur N` / `--hotel-eur N` when a cost needs Ryan.** A foreign
  currency, mixed currencies, or a hedged figure (`<100 EUR (if allowed to use
my own car)`, `up to 80`, `100-150`) sets `needsRyan`, and the run then
  **refuses — dry run included** — rather than writing the parser's reading.
  The refusal prints the raw value, why it stopped, and the flag to use. The
  parsed number is shown as a hint only: **it is not a price**, and passing it
  back unchanged still has to be Ryan's decision, not a default you accept for
  him. `Total` is computed from the figures actually written, never from
  `ask.total`.
- **`Speaking` is written last**, after Notion and after any Approvals row. It
  is the processed marker; nothing else is.

### If the read-back fails

`--apply` finishes with an independent `gviz` read-back. It has now been wrong
twice, in both directions of noise, so read a FAIL before acting on it:

- **`Speaking` alone failed and every Approvals cell passed → re-verify before
  believing it.** Run `--verify` and trust the second read. `Speaking` is written
  last, so it is the freshest cell and the one `gviz` is likeliest to serve
  stale; a genuinely bad write does not land ten neighbouring cells correctly and
  miss only the checkbox. Seen 2026-08-28 on Come To Code — `L115` read `FALSE`
  seconds after a successful type, then `TRUE` on re-verify, 11/11.
- **Never re-type a cell on the strength of one failed read.** Re-typing the
  checkbox is how a false FAIL turns into a real edit against a live sheet.
- **A broad failure is real.** Several cells failing, or an Approvals cell
  disagreeing on content rather than formatting, is a genuine failure: stop,
  report the output verbatim, and hand it to Ryan.

Report the FAIL and the re-verify to Ryan either way — never quietly swallow a
failed check because the retry passed. Log any new failure mode in
[docs/decisions.md](../../../docs/decisions.md).

### If the browser is not ready

Preconditions **flag and stop** — signed out, wrong workbook, editor not loaded.
Report what is wrong and hand it to Ryan; never try to fix it silently. He is
supervising and would rather be told.

## Step 7 — offer the speaker email

**Offer it; never assume it.** Ryan sends this for some entries and not others,
so after the sheet write, ask whether he wants it. Output it as a **raw markdown
code block** so he can copy it straight out — do not send anything anywhere
yourself, and do not render it as prose.

**Never invent an email address.** The form gives supervisor _names_, not
addresses. Write `Name <ADDRESS TO CONFIRM>` for anyone whose address you did
not get from Ryan or a live read.

### The three budget variants

The template assumes travel _and_ accommodation. Adapt both affected sentences
to what was actually approved, and say which variant you used:

| Approved                    | Approval sentence                        | Booking sentence                                  |
| --------------------------- | ---------------------------------------- | ------------------------------------------------- |
| travel + hotel              | `have approved travel and accommodation` | `book your hotel and travel expenses`             |
| travel only                 | `have approved travel`                   | `book your travel expenses`                       |
| hotel only                  | `have approved accommodation`            | `book your hotel`                                 |
| neither (leave, or nothing) | drop the sentence from `We've reviewed…` | **drop the whole TravelPerk/Expensify paragraph** |

Other conditionals:

- **No leave requested** → drop the `please be sure to approve 1 day` sentence
  and the line-manager clause; keep the Learning Leave invitation.
- **A supervisor slot is empty** → drop that clause rather than guessing who
  fills it. If _no_ supervisor is named at all, drop the CC additions and flag
  it to Ryan, because the leave-approval sentence has no addressee.
- **One person covers several slots** → name them once, and say so.

### Template

```markdown
TO: [SPEAKER]

CC: `Amy Lavelle <amy.lavelle@nearform.com>`, [ALL OTHER SUPERVISORS]

SUBJECT: Event Speaking Request - [INSERT INFO]

Hi [INSERT NAME],

Congrats on being selected to be a Speaker at [INSERT CONFERENCE] on [INSERT DATE]. The event has been added to the Events Calendar. We've reviewed your Event Speaking request and have approved travel and accommodation. I believe that you already have approval for the leave from your line manager, [INSERT LM NAME]. I've also CC'ed in [INSERT TD NAME] to keep in the loop on project timing and [INSERT HOD/GM NAME(S)] for visibility into your being selected to speak!

[INSERT LM NAME], please be sure to approve 1 day of Event Speaking leave in Netsuite. [INSERT SPEAKER NAME], if you plan to attend other days, I would invite you to use your Learning Leave as described in the Learning & Development policy.

Please use TravelPerk to book your hotel and travel expenses and Expensify for your meals after your return, see the Event Speaking Program.

Upon your return, can you please fill in the Event Feedback Form? This helps us know what events are interesting for next year!

Be sure to check out the resources (including a Nearform Speaker's Deck template) on the Speakers Toolkit in Notion. After the conference, we'd love to have you write a short blog post about your experience — something in line with either your talk and reception, or the conference experience itself that you'd like to share with others. There are some example posts linked to from the Speakers Toolkit, if you're looking for inspiration / direction.

Finally, if you wish to request swag or other marketing materials, please use the Event Proposal Form with the specifics of what you need, why, and when. Let me know if you have any questions.

All best,

Ryan
```

Leave the template's wording alone otherwise. Requests in the speaker's
`Additional comments:` — a review of their slides, say — are **not** covered by
it; mention them to Ryan separately rather than improvising a paragraph.

## Capturing decisions

Every time Ryan makes a judgment call, append it to
[docs/decisions.md](../../../docs/decisions.md) before moving on. One entry:
date, the situation, what he decided, and the generalisable rule if there is
one. If the same decision shows up three times, propose promoting it into
`docs/workflow.md` as a deterministic rule — that is how inference gets traded
for certainty over time.

Also log what went **wrong**: a script that mis-parsed, a match that was
confidently incorrect, a field that needed re-doing. Those are the entries that
improve this skill.

## Reporting

State coverage, always. "N in the queue, M processed, K skipped, J awaiting
your decision." A quiet queue and a broken read must never look alike. If a
step failed, say so with the output — never report partial success as done.
