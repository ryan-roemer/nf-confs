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

## Status

Early. The Chrome launcher works; the sheet reader and the Notion writer are
next. See [docs/plan.md](docs/plan.md) for the shape of the work and the open
questions.
