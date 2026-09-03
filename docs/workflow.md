# The workflow

Ryan's manual process, as he described it on 2026-08-28, plus what the data says
about it. **This file is the authority on the field mappings.** Never infer a
mapping that isn't written here — ask.

Markers: 🤖 deterministic (a script can decide it) · 🧠 judgment (needs
inference, a web read, or Ryan) · ⛔ Ryan's alone (never automate).

## Stage 1 — triage `Form Responses 1`

1. 🤖 Find entries not yet processed.
2. 🤖 Keep only speaking engagements: `Proposed engagement: ` is
   `Speak at an event representing Nearform`.
3. 🤖 Summarise the ask.
4. ⛔ **Ryan decides whether to accept the budget.** If no, skip. This is never
   automated and never inferred.

### The ask summary

| Report            | `Form Responses 1` column                                                                                                                                                                    | Yes-value     |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| Leave requested?  | `Do you need to use the Event Speaking Program Leave to cover up to 1 day of Leave for the event?`                                                                                           | `YES`         |
| Travel requested? | `Do you need to use the Event Speaking Program to cover travel costs?`                                                                                                                       | `YES`         |
| Hotel requested?  | `Do you need to use the Event Speaking Program to cover up to 2 nights of accommodations for the event? Please use common sense taking into account the distance and duration of the event.` | `YES`         |
| Travel estimate   | `If using the Event Speaking Program for travel, please provide an estimate of the costs`                                                                                                    | raw, verbatim |
| Hotel estimate    | `If using the Event Speaking Program for accomodations, please provide an estimate costs`                                                                                                    | raw, verbatim |

Cost estimates are reported **raw and verbatim** — usually EUR, often not.
🧠 If the currency isn't obviously EUR, stop and ask Ryan; he supplies the EUR
value as input. Never convert a currency ourselves.

## Stage 2 — write the sheet

5. 🤖 **Only if something was actually requested** — `leave`, `travel` or
   `hotel` is YES. An event that asks for nothing has no Approvals row at all,
   whichever engagement variant was chosen. In `2026 Approvals`, fill `Email` · `Conf` · `Date` · `Travel` ·
   `Accomodations` · `Total` · `Leave Days` · `Date Approved`. **Leave `Actuals`
   empty** — that is Ryan's, for later.

   The table below is the **complete** set of columns this workflow writes. A
   column the script writes must appear here; if the two disagree, that is a bug
   in one of them, not a licence to infer.

   | Approvals column | Col | Source                                                 |
   | ---------------- | --- | ------------------------------------------------------ |
   | `Email`          | A   | `Form Responses 1` → `Email Address`                   |
   | `Conf`           | B   | `Form Responses 1` → `Name of the Event or Conference` |
   | `Date`           | C   | `Form Responses 1` → `Event start date`                |
   | `Travel`         | D   | travel estimate, in EUR                                |
   | `Accomodations`  | E   | hotel estimate, in EUR                                 |
   | `Total`          | F   | travel + accommodations                                |
   | `Actuals`        | G   | **never written**                                      |
   | `Leave Days`     | H   | from the leave request                                 |
   | `Date Approved`  | J   | the date the workflow ran — see below                  |

   Column `I` is a spacer and is left empty. Columns `L`–`O` (`Name`,
   `Leave Days`, `Confs`, `Budget`) are Ryan's per-person rollup, **never
   written** by this workflow.

   **`Date Approved` is Ryan's local date**, built from local getters in
   `write.js`. It was UTC until 2026-08-28, which meant a run after ~17:00
   Pacific stamped _tomorrow's_ date; that happened twice in one day and was
   fixed on the second. Never use `toISOString()` here. The column itself is
   established practice: 20/20 records in `2025 Approvals` have it filled.

6. 🤖 In `Speaking Events`, tick `Speaking`. **Leave `Email/Slack Sent`
   unchecked** — that stays Ryan's manual step.

## Stage 3 — the Notion Events Calendar

[Events Calendar, "Events" view](https://app.notion.com/p/nearform/d2494cb441994b1183a7a2cca2640466?v=7d05abf3d15f42448309ac568b77f85e)

7. 🧠 Find whether the event already has an entry. Names are human-entered and
   vary — Ryan's own convention is `CONF NAME DATE` (`JSConf NA 2025`,
   `AI Native Dev Con 2026 - NYC`) but variance is expected and fine.
   **Prefer keying off the conference URL, plus date.** Not the name.
8. 🧠 **Very often the entry already exists**, frequently as a `Suggested`
   event with no speaker. Then: check the fields that already have values, flag
   inconsistencies, and add the new information. A run of this workflow is what
   makes it `Confirmed` with a `Who`.

### `Link` is the source of truth

The conference URL outranks the Google Sheet for every other field. Year-specific
links are preferred; otherwise an ongoing page that will be correct at run time.

⚠️ 🧠 **If the link varies _wildly_ from the sheet — wrong year, wrong country,
wrong event — flag to Ryan before proceeding.** Do not reconcile it silently.

### Field mapping

| Notion property | Source                                                                                                                                                 | Mode                                        |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| `Link`          | `Event website`                                                                                                                                        | 🤖 copy · 🧠 sanity-check against the sheet |
| `Date`          | `Event start date` + `Event duration (in days)` → a range; duration is a number, so compute the end date                                               | 🤖                                          |
| `Event Type`    | `Event Category` (typically `Technical Conference`) → almost always **`Conference`** for this workflow                                                 | 🤖 default, 🧠 on anything unusual          |
| `Engagement`    | always **`Speak`** for this workflow                                                                                                                   | 🤖                                          |
| `Audience`      | `Audience:`, refined against the conference website. Typically `Developers`, `VP Engineering`, `Engineering leaders`                                   | 🧠                                          |
| `Region`        | start from `Location `, then pick a Notion `Region` option                                                                                             | 🤖 mapping table · 🧠 fallback              |
| `CFP Details`   | conference website, or `Event Call for Papers (CFP) link (if applicable)`. Often left blank                                                            | 🧠                                          |
| `Status`        | always **`Confirmed`** for this workflow. May overwrite a previous value                                                                               | 🤖                                          |
| `Who`           | match `Email Address` → Notion person, **two domains** — see below. **Multiple speakers per event happen. Never remove existing speakers — only add.** | 🤖 exact lookup by email                    |
| `Location`      | start from `Location `, then norm against the conference page **and against how existing rows are written** — not standardised                         | 🧠                                          |
| `Affliation`    | figure out from the conference page (note Notion's spelling)                                                                                           | 🧠                                          |
| `CFP Opens`     | from the website / CFP link if determinable. Often not, even when the CFP is open                                                                      | 🧠 best-effort                              |
| `CFP Deadline`  | from the website / CFP link if determinable                                                                                                            | 🧠 best-effort                              |
| `Organiser`     | always **`Tech / Speaker Programme`** for this workflow                                                                                                | 🤖                                          |

Properties this workflow never touches: `Owner`, `Tags`, `Related / CFP`.

### `Who`: two email domains, and guests are invisible to `get_users`

A speaker has **up to two Notion identities**, and the sheet only ever carries
the first:

1. `FIRST.LAST@nearform.com` — the normal workspace member. Try this first.
2. `FIRST.LAST@thenearformway.com` — an **alternate guest account**, usually
   under the **same display name**.

⚠️ **This is a migration, not an edge case.** Many `@nearform.com` members have
been **deactivated in favour of** their `@thenearformway.com` guest account. So
for a large and growing share of speakers the guest account is not an
alternative identity — it is the **only** one, and the sheet's `@nearform.com`
address will never resolve. Expect the second lookup to be the one that works,
and treat a first-lookup miss as routine rather than as a problem to report.

⚠️ **`get_users` does not return guests.** A guest is invisible to every form of
that call — by email, by surname, and by user id — so "no results" is **not**
evidence that the person is absent or deactivated. Do not conclude either.

To tie a guest `user://` id to a human, **render a page that already has them**
in the conference Chrome and read the name Notion draws:

```
'Who' property row →  "Adam Barrett"
```

That is a live read, and it is the only name match available for a guest. Get
Ryan's confirmation before writing a person you could not name this way.

## Confirmed against the data

Verified against the live sheet (112 data rows) and confirmed by Ryan
2026-08-28.

### `Speaking` is the processed marker — `Email/Slack Sent` is not

**"Processed" means `Speaking` is checked in `Speaking Events`.** That is the
workflow's terminal state, and the only thing that removes an entry from the
queue.

**Queue = a speaking engagement whose `Speaking` is unchecked.**

Why not the alternatives:

- **Not an Approvals row.** An event with no leave and no budget ask never gets
  one, yet still has to be processed into Notion. Absence would be ambiguous.
- **Not `Email/Slack Sent`.** That is Ryan's own downstream step, done by hand
  after the workflow finishes. It is informational here and drives nothing.
- **Not the Notion page alone.** Correct in principle, but it makes the queue
  unknowable without a Notion round-trip; `Speaking` is one local read.

⚠️ **INVARIANT: `Speaking` is written LAST.** After the Notion page exists, and
after the Approvals row if there is one. The entire model rests on this — set it
before Notion succeeds and a record is marked done while not being done.

Known cost, accepted: someone may tick `Speaking` early just to categorise an
entry, and the workflow would then skip it silently. That is a miss rather than
corruption, and runs are supervised. If it starts happening, an audit
cross-checking `Speaking`-TRUE rows against Notion would catch it.

| `Speaking` | `Email/Slack Sent` | rows | reading                                    |
| ---------- | ------------------ | ---- | ------------------------------------------ |
| TRUE       | TRUE               | 95   | done, and Ryan has sent his comms          |
| TRUE       | FALSE              | 2    | **done** — Ryan's comms still pending      |
| FALSE      | TRUE               | 10   | all attend/sponsor — not speaking, skipped |
| FALSE      | FALSE              | 3    | **the queue**                              |

### Any `Speak*` value is a speaking engagement

The form has grown suffixed variants and will grow more, so **match the prefix**
rather than enumerating values. Currently:

| Value                                                                                          | Rows | Budget?            |
| ---------------------------------------------------------------------------------------------- | ---- | ------------------ |
| `Speak at an event representing Nearform`                                                      | 78   | yes                |
| `Speak at an event representing Nearform without requesting support or swag (jump to the end)` | 20   | **no**             |
| `Attend an event representing Nearform`                                                        | 7    | n/a — not speaking |
| `Suggest an event for Nearform to sponsor`                                                     | 4    | n/a                |
| `I'm already attending using L&D budget…`                                                      | 1    | n/a                |
| `Emcee`                                                                                        | 1    | n/a                |
| `Reporting a TedX talk, already done`                                                          | 1    | n/a                |

The `without requesting support` variant is a real speaking engagement: it goes
to the **Events Calendar but skips the Approvals write**, since there is nothing
to approve. All 20 have empty leave/travel/hotel.

⚠️ One (`Prairie Dev Con`) answered "without requesting support" yet has
`leave=Yes`. A contradiction in the source data — flag it, never resolve it
automatically.

### `Event start date` is one of two formats

`YYYY-MM-DD` or `DD/MM/YYYY` (European, day-first). Ryan norms toward
`YYYY-MM-DD` by hand over time, so both will coexist indefinitely. Parse as ISO
when it matches ISO, else day-first; **refuse a genuinely ambiguous value** —
`05/10/2026` is 5 October day-first but 10 May month-first. Equal parts
(`10/10/2026`) are unambiguous in effect.

### Row fill colour is invisible to the CSV read

Ryan's visual cue (green = speaking, red = attending, grey = other) is
formatting, and the `gviz` CSV endpoint returns values only. Reading it would
mean scraping the rendered grid DOM, which is virtualised — only on-screen cells
exist, so it would need scrolling and would break often.

**Decision: don't.** `Proposed engagement: ` and the two checkbox columns carry
the same information as data, and Ryan applies the colour himself afterwards.
