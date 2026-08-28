# CLAUDE.md

Tooling for managing Nearform conference speaking budgets and approvals. A
Google Sheet is the intake side, the Notion Events Calendar is the record side,
and this repo bridges them.

- **[docs/workflow.md](docs/workflow.md)** — the authority on every field
  mapping. Never invent a mapping; if it isn't there, ask.
- **[docs/schema.md](docs/schema.md)** — what both systems actually contain,
  from live reads, including the parsing traps.
- **[docs/decisions.md](docs/decisions.md)** — judgment calls Ryan has made.
  Append to it; promote a rule after the third repeat.
- **[docs/plan.md](docs/plan.md)** — design, verified write paths, open questions.
- **`/conf-process`** — the skill that drives the workflow. Don't hand-roll a
  thin version of it in an ordinary session.

## The deterministic/judgment split

Scripts decide everything decidable from data. Inference is for judgment only,
and four things are Ryan's alone and must never be inferred: **accepting a
budget**, **currency conversion**, **picking between two plausible Notion
pages**, and **reconciling a conference link that contradicts the sheet**.

When Ryan makes a judgment call, log it in `docs/decisions.md` — that log is how
inference gets traded for certainty.

## Working here

- **Node ESM, no TypeScript.** `npm run format` (eslint --fix + prettier) before
  handing anything back. Arrow-function consts, JSDoc on exported functions —
  match `scripts/shared/cdp.js`.
- **Never invent the data shape.** Sheet column names, Notion property names and
  types, database IDs, employee names — those come from Ryan or from a live read.
  Write a `TODO:` and ask rather than guessing a schema.
- **Nearform**, lowercase 'f', every time.
- **Counted evidence reports its coverage.** A sweep, a row count, a match tally
  — say how many of the things you meant to check actually answered. Silent drops
  read as real zeroes. A metric that can abstain must make abstention
  distinguishable from a pass.

## Ryan runs the browser

- **The conference Chrome is on CDP at `127.0.0.1:9333`**, a dedicated profile at
  `~/.nf-confs/chrome-profile`, signed into Google and Notion by hand. Managed by
  `scripts/chrome.js` (`npm run chrome:status` first — **check, never assume**).
- **Ryan's everyday Chrome is on `127.0.0.1:9222`** and is his real signed-in
  profile with work tabs open. Do not point conference automation at it. If you
  need it for something unrelated, open a **new** tab
  (`Target.createTarget`), close what you opened, and don't read his other tabs.
- Verification on the conference Chrome is yours to do — connect, read, report.
  Don't hand Ryan a check you could have run.

## Writes to Notion are real and outward-facing

The events hub is a live team database. Anything that creates or edits pages:

- **Dry-run first, and make dry-run the default** where a flag decides. Print the
  exact pages that would be created and the properties that would be set.
- **Idempotency is the whole game.** A second run over the same sheet rows must
  create nothing. Match on a stable key, and say out loud which key you matched
  on and how many rows matched, missed, or were ambiguous.
- **Ambiguous is not a match.** Two plausible existing pages means stop and ask,
  not pick one.

## Stay on the lookout for tune-ups

This file and `docs/plan.md` are working documents, and every session is evidence
about where they're wrong. Watch for: a correction that repeats, a rule that fired
where it shouldn't have, a question you had to ask because no instruction covered
it, a stated fact that no longer matches the repo.

Flag it **at a natural boundary** — after delivering something, never mid-task —
as at most two or three candidates, each with what happened, the concrete edit,
and the target file. Flagging is a proposal; don't edit instruction files
unprompted.
