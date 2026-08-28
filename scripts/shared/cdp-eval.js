/**
 * Evaluate JavaScript in one existing browser tab over raw CDP.
 *
 * Why not Playwright: `connectOverCDP` auto-attaches to EVERY target and waits
 * for each to initialize. With the conference Chrome holding a few heavy SPA
 * tabs (Notion), that reliably exhausts the connect budget and hangs — observed
 * at 11 targets, below our own warn threshold of 12. Everything the read path
 * needs is a single `fetch` in a signed-in page, which is one CDP call.
 *
 * Playwright is still the right tool for driving the Sheets UI (typing, keys).
 * This is for reads.
 */

const DEFAULT_TIMEOUT_MS = 20000;

/** CDP endpoint, matching scripts/shared/cdp.js. */
const PORT = Number(process.env.NF_CONFS_CDP_PORT) || 9333;

/**
 * Find one open page target whose hostname matches.
 * @param {RegExp} hostRe
 */
export const pickTarget = async (hostRe) => {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`, {
    signal: AbortSignal.timeout(5000),
  });
  const targets = await res.json();
  const target = targets.find((t) => {
    if (t.type !== "page") return false;
    try {
      return hostRe.test(new URL(t.url).hostname);
    } catch {
      return false;
    }
  });
  if (!target) {
    throw new Error(
      `No open page matching ${hostRe} in the conference Chrome.\n` +
        `Run: npm run chrome:login`,
    );
  }
  return target;
};

/**
 * Run an expression in the tab and return its value.
 * @param {{webSocketDebuggerUrl: string}} target
 * @param {string} expression
 */
export const evalInTab = (target, expression, timeoutMs = DEFAULT_TIMEOUT_MS) =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`CDP evaluate timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    ws.onopen = () =>
      ws.send(
        JSON.stringify({
          id: 1,
          method: "Runtime.evaluate",
          params: { expression, awaitPromise: true, returnByValue: true },
        }),
      );

    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id !== 1) return;
      clearTimeout(timer);
      ws.close();
      if (msg.error) return reject(new Error(JSON.stringify(msg.error)));
      if (msg.result?.exceptionDetails) {
        return reject(new Error(msg.result.exceptionDetails.text));
      }
      resolve(msg.result.result.value);
    };

    ws.onerror = () => {
      clearTimeout(timer);
      reject(new Error("CDP websocket error"));
    };
  });

/**
 * Fetch a gviz CSV range from inside a signed-in Google tab.
 *
 * ⚠️ gviz COLLAPSES EMPTY ROWS, even inside an explicit range: asking for
 * A1:J30 over a tab whose content ends at row 26 returns 13 lines, not 30. So
 * a line's position in the response says nothing about its sheet row. Use
 * single-row ranges when the row number matters — see lib/rowmap.js.
 *
 * @param {object} target
 * @param {string} key spreadsheet key
 * @param {string} tab tab NAME (gviz ignores an unrecognised gid and silently
 *   returns the first tab)
 * @param {string} [range] A1 range
 */
export const gvizCsv = async (target, key, tab, range) => {
  const url =
    `https://docs.google.com/spreadsheets/d/${key}/gviz/tq?tqx=out:csv` +
    `&headers=0&sheet=${encodeURIComponent(tab)}` +
    (range ? `&range=${encodeURIComponent(range)}` : "");
  const expr =
    "(async () => { const r = await fetch(" +
    JSON.stringify(url) +
    ", { credentials: 'include' }); " +
    "return { status: r.status, text: await r.text() }; })()";
  const res = await evalInTab(target, expr);
  if (res.status !== 200) {
    throw new Error(
      `gviz returned HTTP ${res.status} for tab ${JSON.stringify(tab)}` +
        (range ? ` range ${range}` : "") +
        `\n${(res.text || "").slice(0, 200)}`,
    );
  }
  return res.text;
};
