/**
 * Tests for the matcher's safety valves.
 *
 * The whole design leans on this module refusing to guess, and the `ambiguous`
 * and `needs-review` paths do not fire on today's real data — so they need
 * tests, or a future change could quietly turn "ask Ryan" into "pick one".
 *
 *   npm test
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { classify, isSharedHost, nameSimilarity, urlKey } from "./match.js";

const rec = (o) => ({ website: "", name: "", date: { iso: null }, ...o });
const page = (o) => ({
  url: "p",
  Name: "",
  Link: "",
  d_start: null,
  Status: "[]",
  Who: "[]",
  ...o,
});

test("two pages that are both the same instance -> ambiguous, never a pick", () => {
  const r = classify(
    rec({
      website: "https://x.dev/",
      name: "X Conf",
      date: { iso: "2026-05-01" },
    }),
    [
      page({
        Name: "X Conf 2026",
        Link: "https://x.dev/",
        d_start: "2026-05-01",
      }),
      page({
        Name: "X Conf 2026 (dup)",
        Link: "https://x.dev/",
        d_start: "2026-05-02",
      }),
    ],
  );
  assert.equal(r.verdict, "ambiguous");
  assert.equal(r.best, null, "must not nominate a target when ambiguous");
});

test("same url, different year -> create a new instance, not an update", () => {
  // The live data has Come To Code 2024 and 2025 sharing one URL.
  const r = classify(
    rec({
      website: "https://x.dev/",
      name: "X Conf",
      date: { iso: "2026-05-01" },
    }),
    [
      page({
        Name: "X Conf 2025",
        Link: "https://x.dev/",
        d_start: "2025-05-01",
      }),
    ],
  );
  assert.equal(r.verdict, "create");
  assert.equal(
    r.priorYears.length,
    1,
    "prior year should be offered as a template",
  );
});

test("shared platform host does not make two different events match", () => {
  // gdg.community.dev hosts every DevFest worldwide.
  const r = classify(
    rec({
      website: "https://gdg.community.dev/events/details/a-2026/",
      name: "DevFest Roma",
      date: { iso: "2026-10-10" },
    }),
    [
      page({
        Name: "DevFest Campobasso 2026",
        Link: "https://gdg.community.dev/events/details/b-2026/",
        d_start: "2026-10-10",
      }),
    ],
  );
  assert.equal(r.verdict, "create");
});

test("no website and no date -> needs-review", () => {
  const r = classify(rec({ name: "Mystery" }), [
    page({ Name: "Mystery 2026", d_start: "2026-01-01" }),
  ]);
  assert.equal(r.verdict, "needs-review");
});

test("exact url and date -> update", () => {
  const r = classify(
    rec({
      website: "https://x.dev/",
      name: "X Conf",
      date: { iso: "2026-05-01" },
    }),
    [
      page({
        Name: "X Conf 2026",
        Link: "https://x.dev/",
        d_start: "2026-05-01",
      }),
    ],
  );
  assert.equal(r.verdict, "update");
  assert.ok(r.best, "update must nominate the page to write to");
});

test("urlKey normalises host and trailing slash but keeps a year in the path", () => {
  assert.equal(urlKey("https://WWW.X.dev/path/"), "x.dev/path");
  assert.equal(urlKey("https://x.dev/2026/"), "x.dev/2026");
  assert.equal(urlKey("x.dev/a?utm=1#z"), "x.dev/a");
  assert.equal(urlKey(""), null);
});

test("shared hosts are recognised, a conference's own domain is not", () => {
  assert.equal(isSharedHost("gdg.community.dev"), true);
  assert.equal(isSharedHost("cometocode.it"), false);
});

test("name similarity ignores the year", () => {
  assert.equal(nameSimilarity("Come To Code 2026", "Come To Code 2024"), 1);
});
