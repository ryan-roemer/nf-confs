/**
 * A persistent raw-CDP connection to one tab, with keyboard input.
 *
 * Why not Playwright: `connectOverCDP` auto-attaches to every target and waits
 * for each to initialize. It hung repeatedly against the conference Chrome at
 * 11 open targets, four of them Notion SPAs. This attaches to exactly one tab.
 *
 * Typing is dispatched as real key events (keyDown / char / keyUp) rather than
 * `Input.insertText`, because the Sheets grid is not a text input — it listens
 * for keystrokes, and inserted text does not reach its handlers.
 */

const DEFAULT_TIMEOUT_MS = 20000;

/** Key definitions for the non-printable keys the write path needs. */
const KEYS = {
  Enter: { keyCode: 13, key: "Enter", code: "Enter", text: "\r" },
  Tab: { keyCode: 9, key: "Tab", code: "Tab", text: "\t" },
  Escape: { keyCode: 27, key: "Escape", code: "Escape" },
  Delete: { keyCode: 46, key: "Delete", code: "Delete" },
};

export class CdpSession {
  #ws;
  #nextId = 1;
  #pending = new Map();

  constructor(ws) {
    this.#ws = ws;
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id === undefined) return; // an event, not a reply
      const entry = this.#pending.get(msg.id);
      if (!entry) return;
      this.#pending.delete(msg.id);
      clearTimeout(entry.timer);
      if (msg.error) entry.reject(new Error(JSON.stringify(msg.error)));
      else entry.resolve(msg.result);
    };
  }

  /**
   * Attach to one open page target.
   * @param {RegExp} hostRe
   */
  static async open(
    hostRe,
    port = Number(process.env.NF_CONFS_CDP_PORT) || 9333,
  ) {
    const res = await fetch(`http://127.0.0.1:${port}/json/list`, {
      signal: AbortSignal.timeout(5000),
    });
    const targets = await res.json();
    const pages = targets.filter((t) => {
      if (t.type !== "page") return false;
      try {
        return hostRe.test(new URL(t.url).hostname);
      } catch {
        return false;
      }
    });
    // Prefer a tab already on a spreadsheet. This session navigates the tab it
    // picks, and grabbing an unrelated Google tab would navigate one Ryan is
    // using out from under him.
    const target =
      pages.find((t) => t.url.includes("/spreadsheets/d/")) ?? pages[0];
    if (!target) {
      throw new Error(
        `No open page matching ${hostRe} in the conference Chrome.\n` +
          `Run: npm run chrome:login`,
      );
    }
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("CDP connect timed out")),
        10000,
      );
      ws.onopen = () => {
        clearTimeout(timer);
        resolve();
      };
      ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error("CDP websocket error"));
      };
    });
    return new CdpSession(ws);
  }

  send(method, params = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`CDP ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.#pending.set(id, { resolve, reject, timer });
      this.#ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /** Evaluate an expression and return its value. Throws on a page exception. */
  async evaluate(expression, timeoutMs = DEFAULT_TIMEOUT_MS) {
    const r = await this.send(
      "Runtime.evaluate",
      { expression, awaitPromise: true, returnByValue: true },
      timeoutMs,
    );
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  }

  /** Press a named key (Enter, Tab, Escape, Delete). */
  async press(name) {
    const k = KEYS[name];
    if (!k) throw new Error(`Unknown key: ${name}`);
    const base = {
      windowsVirtualKeyCode: k.keyCode,
      nativeVirtualKeyCode: k.keyCode,
      key: k.key,
      code: k.code,
    };
    await this.send("Input.dispatchKeyEvent", {
      type: "keyDown",
      ...base,
      text: k.text ?? "",
    });
    await this.send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
  }

  /**
   * Type printable text one character at a time as real key events. Slower
   * than insertText and deliberately so — the Sheets grid only responds to
   * keystrokes.
   */
  async type(text) {
    for (const ch of String(text)) {
      await this.send("Input.dispatchKeyEvent", {
        type: "keyDown",
        text: ch,
        unmodifiedText: ch,
        key: ch,
      });
      await this.send("Input.dispatchKeyEvent", { type: "keyUp", key: ch });
    }
  }

  async wait(ms) {
    await new Promise((r) => setTimeout(r, ms));
  }

  close() {
    try {
      this.#ws.close();
    } catch {
      /* already closed */
    }
  }
}

/**
 * Move the Sheets grid selection to a cell using the Name Box — the
 * cell-reference input left of the formula bar, `#t-name-box`. This avoids
 * clicking cells in the virtualised grid, where a cell may not exist in the DOM.
 */
export const gotoCell = async (session, ref) => {
  const focused = await session.evaluate(`
    (() => {
      const el = document.querySelector("#t-name-box");
      if (!el) return false;
      el.focus();
      el.select();
      return true;
    })()
  `);
  if (!focused) {
    throw new Error(
      "Name Box (#t-name-box) not found — is this tab the Sheets editor?",
    );
  }
  await session.type(ref);
  await session.press("Enter");
  await session.wait(350);
};
