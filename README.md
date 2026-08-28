# NF Conference Support

Tooling to help manage Nearform conference speaking budgets and approvals.

Two systems hold the truth today and neither knows about the other:

- **A Google Sheet** — conference info, as it arrives. The intake side.
- **A Notion "events hub" database** — the conferences we have speakers at, and
  which employees are speaking. The record side.

The manual workflow this repo is here to shrink:

1. Review the sheet for entries that haven't been processed yet.
2. For each one, add it to the Notion events hub if it isn't already there.
3. Mark which employees are speakers.

## Access model

Both systems are behind a corporate SSO login with no service credentials handy,
so the scripts drive a **dedicated Chrome that you sign into by hand, once**:

```bash
npm run chrome          # print the launch command, don't run it
npm run chrome:run      # spawn it, detached
npm run chrome:status   # what's listening, what's open, what's signed in
```

It is deliberately a separate Chrome from your everyday one:

- Chrome only enables `--remote-debugging-port` on a fresh process per
  `--user-data-dir`, so a second profile is the only way to have both at once.
- Your everyday Chrome keeps port **9222**. This one takes **9333**
  (override with `NF_CONFS_CDP_PORT`).
- Profile dir: `~/.nf-confs/chrome-profile`. Cookies persist, so signing in is a
  one-off. No session restore, so a relaunch always comes back with zero stray
  tabs.

First run, sign into `https://docs.google.com` and `https://www.notion.so` in
the new window, then `npm run chrome:status` to confirm.

## Troubleshooting

**"Could not connect" / an error about `Browser.setDownloadBehavior`.**
Almost certainly the conference Chrome is running with **no tabs open**. Closing
the last tab does not quit a Chrome with remote debugging enabled — the process
survives, the port keeps answering, and Playwright then refuses to attach to a
window-less browser with an error that mentions download behaviour and nothing
useful. `npm run chrome:status` names this state directly, and both
`chrome:status` and any pipeline script will heal it by opening a blank tab.

**Attach is slow or times out with lots of tabs open.** Playwright's
`connectOverCDP` auto-attaches to every target and waits for each one, so
accumulated tabs eat the connect budget before our code runs. Close the strays,
or relaunch — the profile has no session restore, so it comes back clean.

## Commands

```bash
npm run chrome:status          # is the conference Chrome up and signed in?
npm run chrome:login           # open the sign-in tabs
npm run sheet:probe -- --save  # exact per-tab read -> .data/sheet/*.csv
npm run sheet:pending          # the queue: what's waiting on a decision
npm run notion:match           # update-vs-create plan against the Events Calendar
npm run format                 # eslint --fix + prettier
```

The workflow itself runs through the **`/conf-process`** skill, which calls
these and asks for a decision wherever one is needed.

## Status

End-to-end working, and exercised once for real (DevFest Campobasso, 2026-08-28):
triage, the Notion matcher, a Notion page create, and the sheet write — Approvals
row plus the `Speaking` tick, verified on two independent paths.

**Read [docs/decisions.md](docs/decisions.md) before changing the write path.**
It records an incident where a write landed in the wrong worksheet and corrupted
a live record, and the guards that now prevent it. The short version: a cell
reference is meaningless without its worksheet, so writes address
`'Tab Name'!A14` atomically and refuse to touch a cell whose current content
isn't what was expected.

See [docs/plan.md](docs/plan.md) for the design and what's left.
