# In-App User Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Send Feedback" entry to the PLVS Settings panel that emails free-text feedback (plus an optional reply email) to the maintainer via the existing `soundoer-newsletter` service and SES relay.

**Architecture:** A new `POST /feedback` route on the already-deployed `soundoer-newsletter` Fastify service composes and sends the feedback as an email (reusing the existing SMTP transport), with `Reply-To` set to the submitter's email when provided. The PLVS desktop app gets a new draggable `FeedbackDialog` (portaled to `document.body`, styled like the existing `ThemeEditor`) reachable from a new "Feedback" section in `SettingsPanel`, which POSTs JSON to that endpoint via plain `fetch`.

**Tech Stack:** React 19 (JS, no TS) + Radix UI primitives + Tailwind on the PLVS side; Fastify 5 + `@fastify/cors` + `@fastify/rate-limit` + Nodemailer/SES on the `soundoer-newsletter` side. Vitest for PLVS frontend tests, Node's built-in `node:test` for `soundoer-newsletter`.

**Spec:** [docs/superpowers/specs/2026-07-03-in-app-feedback-design.md](../specs/2026-07-03-in-app-feedback-design.md)

**Repos touched:** `C:\Users\shenxichen\repos\PLVS` (this repo) and `C:\Users\shenxichen\repos\soundoer-newsletter` (sibling repo, separate git history/remote — commits in the two repos are independent).

**Design deviation from the spec (found during planning, not a scope change):** the spec assumed the existing `@fastify/cors` config (single origin = the landing page) would just work. It won't: Tauri's webview sends its own `Origin` header (`tauri://localhost` on macOS, `http://tauri.localhost` on Windows) which doesn't match `https://plvs.soundoer.com`, so a POST from the desktop app would be blocked by CORS. Task 4 below changes `ALLOWED_ORIGIN` from a single string to a comma-separated list parsed into an array, so both the landing page and the desktop app's origins are allowed. This only affects the backend's CORS config, not any product-level decision from the spec.

---

## Task 1: `renderFeedbackEmail` in `soundoer-newsletter`

**Files:**
- Modify: `C:\Users\shenxichen\repos\soundoer-newsletter\src\email.js`
- Test: `C:\Users\shenxichen\repos\soundoer-newsletter\test\email.test.js`

- [ ] **Step 1: Write the failing test**

Append to `test/email.test.js`:

```js
test("feedback email includes the content and the submitter's email when provided", () => {
  const msg = renderFeedbackEmail({ content: "The meter flickers on resize", email: "user@example.com" });
  assert.equal(msg.subject, "PLVS feedback");
  assert.ok(msg.text.includes("The meter flickers on resize"));
  assert.ok(msg.text.includes("user@example.com"));
});

test("feedback email notes a missing email instead of leaving it blank", () => {
  const msg = renderFeedbackEmail({ content: "Great app!", email: "" });
  assert.ok(msg.text.includes("(no email provided)"));
});
```

Also update the import line at the top of `test/email.test.js`:

```js
import { renderConfirmationEmail, renderNewsletter, renderFeedbackEmail } from "../src/email.js";
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd C:\Users\shenxichen\repos\soundoer-newsletter && npm test`
Expected: FAIL — `renderFeedbackEmail is not a function` (or `undefined`).

- [ ] **Step 3: Write minimal implementation**

Append to `src/email.js` (after `renderNewsletter`, before `createSendMail`):

```js
export function renderFeedbackEmail({ content, email }) {
  return {
    subject: "PLVS feedback",
    text: `${content}\n\n---\nFrom: ${email || "(no email provided)"}`,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd C:\Users\shenxichen\repos\soundoer-newsletter && npm test`
Expected: PASS, all tests green (including the pre-existing ones).

- [ ] **Step 5: Commit**

```bash
cd C:\Users\shenxichen\repos\soundoer-newsletter
git add src/email.js test/email.test.js
git commit -m "feat: add renderFeedbackEmail for in-app feedback"
```

---

## Task 2: `handleFeedback` validation in `soundoer-newsletter`

**Files:**
- Create: `C:\Users\shenxichen\repos\soundoer-newsletter\src\feedback.js`
- Test: `C:\Users\shenxichen\repos\soundoer-newsletter\test\feedback.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/feedback.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidContent, handleFeedback } from "../src/feedback.js";

function setup() {
  const sent = [];
  const sendFeedback = async ({ content, email }) => sent.push({ content, email });
  return { sent, sendFeedback };
}

test("isValidContent accepts non-empty strings under the length cap and rejects the rest", () => {
  assert.ok(isValidContent("hello"));
  assert.ok(!isValidContent(""));
  assert.ok(!isValidContent("   "));
  assert.ok(!isValidContent(undefined));
  assert.ok(!isValidContent("x".repeat(5001)));
  assert.ok(isValidContent("x".repeat(5000)));
});

test("valid content with no email is sent with email set to null", async () => {
  const { sent, sendFeedback } = setup();
  const res = await handleFeedback({ content: "Great app!", email: "", sendFeedback });
  assert.equal(res.status, "sent");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].content, "Great app!");
  assert.equal(sent[0].email, null);
});

test("valid content with a valid email is sent with that email", async () => {
  const { sent, sendFeedback } = setup();
  const res = await handleFeedback({ content: "Great app!", email: "a@example.com", sendFeedback });
  assert.equal(res.status, "sent");
  assert.equal(sent[0].email, "a@example.com");
});

test("empty content is rejected without sending", async () => {
  const { sent, sendFeedback } = setup();
  const res = await handleFeedback({ content: "", email: "", sendFeedback });
  assert.equal(res.status, "invalid_content");
  assert.equal(sent.length, 0);
});

test("malformed email is rejected without sending", async () => {
  const { sent, sendFeedback } = setup();
  const res = await handleFeedback({ content: "Great app!", email: "nope", sendFeedback });
  assert.equal(res.status, "invalid_email");
  assert.equal(sent.length, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd C:\Users\shenxichen\repos\soundoer-newsletter && npm test`
Expected: FAIL — `Cannot find module '../src/feedback.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/feedback.js`:

```js
import { isValidEmail } from "./subscribe.js";

const MAX_CONTENT_LENGTH = 5000;

export function isValidContent(content) {
  return typeof content === "string" && content.trim().length > 0 && content.length <= MAX_CONTENT_LENGTH;
}

export async function handleFeedback({ content, email, sendFeedback }) {
  if (!isValidContent(content)) return { status: "invalid_content" };
  if (email && !isValidEmail(email)) return { status: "invalid_email" };

  await sendFeedback({ content, email: email || null });
  return { status: "sent" };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd C:\Users\shenxichen\repos\soundoer-newsletter && npm test`
Expected: PASS, all tests green.

- [ ] **Step 5: Commit**

```bash
cd C:\Users\shenxichen\repos\soundoer-newsletter
git add src/feedback.js test/feedback.test.js
git commit -m "feat: add handleFeedback content/email validation"
```

---

## Task 3: `POST /feedback` route

**Files:**
- Modify: `C:\Users\shenxichen\repos\soundoer-newsletter\src\server.js`
- Test: `C:\Users\shenxichen\repos\soundoer-newsletter\test\server.test.js`

- [ ] **Step 1: Write the failing test**

Update the top of `test/server.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb, getByEmail } from "../src/db.js";
import { buildServer } from "../src/server.js";

function setup() {
  const db = openDb(":memory:");
  const sent = [];
  const sendMail = async (message) => { sent.push(message); };
  const app = buildServer({
    db,
    sendMail,
    baseUrl: "https://list.example.com",
    fromEmail: "newsletter@soundoer.com",
    fromName: "PLVS",
    feedbackTo: "xichen@soundoer.com",
  });
  return { db, sent, app };
}
```

(Only the `buildServer` call inside `setup()` changes — it gains `feedbackTo: "xichen@soundoer.com"`.)

Append these tests to the end of the file:

```js
test("POST /feedback sends mail to the maintainer with Reply-To set to the submitter", async () => {
  const { sent, app } = setup();
  const res = await app.inject({
    method: "POST",
    url: "/feedback",
    payload: { content: "The meter flickers on resize", email: "user@example.com" },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "xichen@soundoer.com");
  assert.equal(sent[0].replyTo, "user@example.com");
  assert.ok(sent[0].text.includes("The meter flickers on resize"));
  await app.close();
});

test("POST /feedback with no email omits Reply-To", async () => {
  const { sent, app } = setup();
  const res = await app.inject({
    method: "POST",
    url: "/feedback",
    payload: { content: "Great app!" },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(sent[0].replyTo, undefined);
  await app.close();
});

test("POST /feedback with empty content returns 400", async () => {
  const { sent, app } = setup();
  const res = await app.inject({ method: "POST", url: "/feedback", payload: { content: "" } });
  assert.equal(res.statusCode, 400);
  assert.equal(sent.length, 0);
  await app.close();
});

test("POST /feedback with malformed email returns 400", async () => {
  const { sent, app } = setup();
  const res = await app.inject({
    method: "POST",
    url: "/feedback",
    payload: { content: "Great app!", email: "nope" },
  });
  assert.equal(res.statusCode, 400);
  assert.equal(sent.length, 0);
  await app.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd C:\Users\shenxichen\repos\soundoer-newsletter && npm test`
Expected: FAIL — 404s on `POST /feedback` (route doesn't exist yet).

- [ ] **Step 3: Write minimal implementation**

In `src/server.js`, update the import line:

```js
import { renderConfirmationEmail, renderFeedbackEmail } from "./email.js";
import { handleFeedback } from "./feedback.js";
```

Change the `buildServer` signature to accept `feedbackTo`:

```js
export function buildServer({ db, sendMail, baseUrl, fromEmail, fromName, feedbackTo }) {
```

Add the route (after the `/subscribe` route, before `/confirm`):

```js
  app.post("/feedback", async (req, reply) => {
    const { content, email } = req.body ?? {};
    const result = await handleFeedback({
      content,
      email,
      sendFeedback: async ({ content, email }) => {
        const msg = renderFeedbackEmail({ content, email });
        await sendMail({
          from: `${fromName} <${fromEmail}>`,
          to: feedbackTo,
          replyTo: email || undefined,
          ...msg,
        });
      },
    });
    if (result.status === "invalid_content") {
      return reply.code(400).send({ ok: false, error: "invalid content" });
    }
    if (result.status === "invalid_email") {
      return reply.code(400).send({ ok: false, error: "invalid email" });
    }
    return reply.code(200).send({ ok: true });
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd C:\Users\shenxichen\repos\soundoer-newsletter && npm test`
Expected: PASS, all tests green.

- [ ] **Step 5: Commit**

```bash
cd C:\Users\shenxichen\repos\soundoer-newsletter
git add src/server.js test/server.test.js
git commit -m "feat: add POST /feedback route"
```

---

## Task 4: Multi-origin CORS + `FEEDBACK_TO` config

**Files:**
- Modify: `C:\Users\shenxichen\repos\soundoer-newsletter\src\config.js`
- Modify: `C:\Users\shenxichen\repos\soundoer-newsletter\src\start.js`
- Modify: `C:\Users\shenxichen\repos\soundoer-newsletter\.env.example`
- Modify: `C:\Users\shenxichen\repos\soundoer-newsletter\.env`

No dedicated test file exists for `config.js` or `start.js` today (consistent with the rest of the repo) — this task is config wiring, verified via the deploy smoke test in Task 11.

- [ ] **Step 1: Update `src/config.js`**

Change the `allowedOrigin` field to `allowedOrigins` (array, comma-separated), and add `feedbackTo`:

```js
export const config = {
  port: Number(process.env.PORT ?? 3000),
  baseUrl: required("BASE_URL"),
  allowedOrigins: required("ALLOWED_ORIGIN")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  databasePath: process.env.DATABASE_PATH ?? "./data/subscribers.db",
  smtp: {
    host: required("SMTP_HOST"),
    port: Number(process.env.SMTP_PORT ?? 587),
    user: required("SMTP_USER"),
    pass: required("SMTP_PASS"),
  },
  fromEmail: required("FROM_EMAIL"),
  fromName: process.env.FROM_NAME ?? "PLVS",
  replyTo: process.env.REPLY_TO ?? "",
  feedbackTo: process.env.FEEDBACK_TO || process.env.REPLY_TO || required("FEEDBACK_TO"),
  contactAddress: process.env.CONTACT_ADDRESS ?? "",
};
```

- [ ] **Step 2: Update `src/start.js`**

Change the `buildServer` call to pass `feedbackTo`, and the cors registration to use `allowedOrigins`:

```js
const app = buildServer({
  db,
  sendMail,
  baseUrl: config.baseUrl,
  fromEmail: config.fromEmail,
  fromName: config.fromName,
  feedbackTo: config.feedbackTo,
});

await app.register(cors, { origin: config.allowedOrigins, methods: ["POST"] });
```

- [ ] **Step 3: Update `.env.example`**

Change the `ALLOWED_ORIGIN` line and comment, and add `FEEDBACK_TO` near `REPLY_TO`:

```
# Origins allowed to POST /subscribe and /feedback (comma-separated).
# The landing page, plus the PLVS desktop app's webview origins (macOS/Linux
# and Windows use different schemes).
ALLOWED_ORIGIN=https://plvs.soundoer.com,tauri://localhost,http://tauri.localhost

# Sender identity (domain must be SES-verified with DKIM)
FROM_EMAIL=newsletter@soundoer.com
FROM_NAME=PLVS

# Where reader replies to the newsletter should land (optional)
REPLY_TO=xichen@soundoer.com

# Where in-app feedback (Settings > Send Feedback) is emailed. Falls back to
# REPLY_TO if unset.
FEEDBACK_TO=xichen@soundoer.com
```

- [ ] **Step 4: Apply the same change to `.env`**

Mirror the same `ALLOWED_ORIGIN` and `FEEDBACK_TO` edits in `.env` (local dev file, gitignored — this keeps local `npm test`/manual runs consistent with `.env.example`).

- [ ] **Step 5: Run the full test suite to confirm nothing broke**

Run: `cd C:\Users\shenxichen\repos\soundoer-newsletter && npm test`
Expected: PASS, all tests green (this task doesn't add tests, it must not break existing ones).

- [ ] **Step 6: Commit**

```bash
cd C:\Users\shenxichen\repos\soundoer-newsletter
git add src/config.js src/start.js .env.example
git commit -m "feat: support multiple CORS origins and FEEDBACK_TO for /feedback"
```

(`.env` is gitignored and won't be picked up by `git add` of tracked paths above — no separate step needed, but double check with `git status` that it doesn't appear staged.)

---

## Task 5: `submitFeedback` client in PLVS

**Files:**
- Create: `C:\Users\shenxichen\repos\PLVS\src\lib\feedback.js`
- Test: `C:\Users\shenxichen\repos\PLVS\src\lib\feedback.test.js`

- [ ] **Step 1: Write the failing test**

Create `src/lib/feedback.test.js`:

```js
import { afterEach, describe, expect, it, vi } from "vitest";
import { submitFeedback } from "./feedback.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("submitFeedback", () => {
  it("posts content and email as JSON and resolves true on success", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      submitFeedback({ content: "hello", email: "a@example.com" })
    ).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledWith("https://list.plvs.soundoer.com/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "hello", email: "a@example.com" }),
    });
  });

  it("resolves false on a non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    await expect(submitFeedback({ content: "hello" })).resolves.toBe(false);
  });

  it("resolves false when fetch rejects (offline/network error)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
    await expect(submitFeedback({ content: "hello" })).resolves.toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd C:\Users\shenxichen\repos\PLVS && npx vitest run src/lib/feedback.test.js`
Expected: FAIL — `Cannot find module './feedback.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/feedback.js`:

```js
/**
 * POST feedback content (and optional reply email) to the soundoer-newsletter
 * /feedback endpoint. Returns true on success, false on any failure (network
 * error, non-2xx response) — the caller doesn't need to distinguish why.
 */

const FEEDBACK_URL = "https://list.plvs.soundoer.com/feedback";

/**
 * @param {{ content: string, email?: string }} input
 * @returns {Promise<boolean>}
 */
export async function submitFeedback({ content, email }) {
  try {
    const res = await fetch(FEEDBACK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, email }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd C:\Users\shenxichen\repos\PLVS && npx vitest run src/lib/feedback.test.js`
Expected: PASS, 3 tests green.

- [ ] **Step 5: Commit**

```bash
cd C:\Users\shenxichen\repos\PLVS
git add src/lib/feedback.js src/lib/feedback.test.js
git commit -m "feat: add submitFeedback client for in-app feedback"
```

---

## Task 6: Whitelist the feedback domain in Tauri's CSP

**Files:**
- Modify: `C:\Users\shenxichen\repos\PLVS\src-tauri\tauri.conf.json`

- [ ] **Step 1: Add `https://list.plvs.soundoer.com` to both CSP strings**

In `src-tauri/tauri.conf.json`, change the `csp` line:

```json
      "csp": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: asset: http://asset.localhost; font-src 'self' data:; connect-src ipc: http://ipc.localhost https://api.github.com https://list.plvs.soundoer.com",
```

And the `devCsp` line:

```json
      "devCsp": "default-src 'self' http://localhost:1420; script-src 'self' 'unsafe-eval' http://localhost:1420; style-src 'self' 'unsafe-inline' http://localhost:1420; img-src 'self' data: asset: http://asset.localhost http://localhost:1420; font-src 'self' data: http://localhost:1420; connect-src ipc: http://ipc.localhost http://localhost:1420 ws://localhost:1421 https://api.github.com https://list.plvs.soundoer.com"
```

- [ ] **Step 2: Verify the JSON is still valid**

Run: `cd C:\Users\shenxichen\repos\PLVS && node -e "JSON.parse(require('fs').readFileSync('src-tauri/tauri.conf.json', 'utf8'))"`
Expected: no output, exit code 0 (throws and prints a `SyntaxError` if the JSON is malformed).

- [ ] **Step 3: Commit**

```bash
cd C:\Users\shenxichen\repos\PLVS
git add src-tauri/tauri.conf.json
git commit -m "feat: whitelist list.plvs.soundoer.com in CSP for in-app feedback"
```

---

## Task 7: `FeedbackDialog` component

**Files:**
- Create: `C:\Users\shenxichen\repos\PLVS\src\components\FeedbackDialog.jsx`
- Test: `C:\Users\shenxichen\repos\PLVS\src\components\FeedbackDialog.test.jsx`

This is modeled on `src/components/ThemeEditor.jsx`'s draggable floating panel (same drag mechanics via `clampPanelPos`), but with its own local content/email/status state instead of a lifted "draft" — there's no live document-theme preview to coordinate, so nothing needs to live outside this component.

- [ ] **Step 1: Write the failing test**

Create `src/components/FeedbackDialog.test.jsx`:

```jsx
/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { FeedbackDialog } from "./FeedbackDialog.jsx";

vi.mock("@/lib/feedback.js", () => ({
  submitFeedback: vi.fn(),
}));

import { submitFeedback } from "@/lib/feedback.js";

afterEach(() => {
  vi.clearAllMocks();
});

describe("FeedbackDialog", () => {
  it("disables submit until content is entered", () => {
    render(<FeedbackDialog onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    fireEvent.input(screen.getByLabelText("Feedback content"), {
      target: { value: "Great app!" },
    });
    expect(screen.getByRole("button", { name: "Send" })).not.toBeDisabled();
  });

  it("blocks submit and shows an inline error for a malformed email", () => {
    render(<FeedbackDialog onClose={vi.fn()} />);
    fireEvent.input(screen.getByLabelText("Feedback content"), {
      target: { value: "Great app!" },
    });
    fireEvent.input(screen.getByLabelText("Your email (optional)"), {
      target: { value: "nope" },
    });
    fireEvent.blur(screen.getByLabelText("Your email (optional)"));
    expect(screen.getByText("Enter a valid email or leave it blank.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });

  it("submits content and email, shows success, and closes after a delay", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    submitFeedback.mockResolvedValue(true);
    const onClose = vi.fn();
    render(<FeedbackDialog onClose={onClose} />);

    fireEvent.input(screen.getByLabelText("Feedback content"), {
      target: { value: "Great app!" },
    });
    fireEvent.input(screen.getByLabelText("Your email (optional)"), {
      target: { value: "a@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() =>
      expect(submitFeedback).toHaveBeenCalledWith({
        content: "Great app!",
        email: "a@example.com",
      })
    );
    expect(await screen.findByText("Thanks! Feedback sent.")).toBeTruthy();

    vi.advanceTimersByTime(2000);
    expect(onClose).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("shows a failure message and preserves input when the request fails", async () => {
    submitFeedback.mockResolvedValue(false);
    render(<FeedbackDialog onClose={vi.fn()} />);

    fireEvent.input(screen.getByLabelText("Feedback content"), {
      target: { value: "Great app!" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText("Failed to send, please try again.")).toBeTruthy();
    expect(screen.getByLabelText("Feedback content").value).toBe("Great app!");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd C:\Users\shenxichen\repos\PLVS && npx vitest run src/components/FeedbackDialog.test.jsx`
Expected: FAIL — `Cannot find module './FeedbackDialog.jsx'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/components/FeedbackDialog.jsx`:

```jsx
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { clampPanelPos } from "../lib/dragClamp.js";
import { submitFeedback } from "../lib/feedback.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INITIAL_POS = { x: 120, y: 120 };
const CLOSE_DELAY_MS = 2000;

/**
 * @param {{ onClose: () => void }} props
 */
export function FeedbackDialog({ onClose }) {
  const [content, setContent] = useState("");
  const [email, setEmail] = useState("");
  const [emailTouched, setEmailTouched] = useState(false);
  const [status, setStatus] = useState(/** @type {"idle"|"sending"|"sent"|"error"} */ ("idle"));
  const [pos, setPos] = useState(INITIAL_POS);

  const ref = useRef(null);
  const dragRef = useRef(null);

  function onPointerDown(e) {
    const rect = ref.current.getBoundingClientRect();
    dragRef.current = {
      dx: e.clientX - rect.left,
      dy: e.clientY - rect.top,
      w: rect.width,
      h: rect.height,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e) {
    const d = dragRef.current;
    if (!d) return;
    setPos(
      clampPanelPos(
        { x: e.clientX - d.dx, y: e.clientY - d.dy },
        { w: d.w, h: d.h },
        { w: window.innerWidth, h: window.innerHeight }
      )
    );
  }
  function onPointerUp() {
    dragRef.current = null;
  }

  const emailInvalid = emailTouched && email.trim() !== "" && !EMAIL_RE.test(email);
  const canSubmit = content.trim().length > 0 && !emailInvalid && status !== "sending";

  async function handleSubmit() {
    setStatus("sending");
    const trimmedEmail = email.trim();
    const ok = await submitFeedback({
      content: content.trim(),
      email: trimmedEmail || undefined,
    });
    if (ok) {
      setStatus("sent");
      setTimeout(onClose, CLOSE_DELAY_MS);
    } else {
      setStatus("error");
    }
  }

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Send feedback"
      className="fixed z-50 flex w-80 flex-col gap-2 overflow-hidden rounded-[var(--ui-radius-modal)] border border-border bg-card text-card-foreground shadow-lg"
      style={{ left: pos.x, top: pos.y }}
    >
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className="flex cursor-move items-center justify-between border-b border-border px-3 py-2"
      >
        <span className="text-[length:var(--ui-fs-panel-title)] font-semibold">
          Send Feedback
        </span>
      </div>

      <div className="flex flex-col gap-2 px-3 py-2">
        <textarea
          aria-label="Feedback content"
          value={content}
          onInput={(e) => setContent(e.target.value)}
          rows={5}
          placeholder="What's on your mind?"
          className="resize-none rounded-md border border-input bg-transparent px-2 py-1.5 text-[length:var(--ui-fs-display)] outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        <input
          aria-label="Your email (optional)"
          type="email"
          value={email}
          onInput={(e) => setEmail(e.target.value)}
          onBlur={() => setEmailTouched(true)}
          placeholder="you@example.com (optional)"
          className="rounded-md border border-input bg-transparent px-2 py-1.5 text-[length:var(--ui-fs-display)] outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        {emailInvalid ? (
          <span className="text-[length:var(--ui-fs-axis)] text-destructive">
            Enter a valid email or leave it blank.
          </span>
        ) : null}
        {status === "error" ? (
          <span className="text-[length:var(--ui-fs-axis)] text-destructive">
            Failed to send, please try again.
          </span>
        ) : null}
        {status === "sent" ? (
          <span className="text-[length:var(--ui-fs-axis)] text-muted-foreground">
            Thanks! Feedback sent.
          </span>
        ) : null}
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-border px-3 py-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} disabled={!canSubmit}>
          {status === "sending" ? "Sending..." : "Send"}
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd C:\Users\shenxichen\repos\PLVS && npx vitest run src/components/FeedbackDialog.test.jsx`
Expected: PASS, 4 tests green.

- [ ] **Step 5: Commit**

```bash
cd C:\Users\shenxichen\repos\PLVS
git add src/components/FeedbackDialog.jsx src/components/FeedbackDialog.test.jsx
git commit -m "feat: add FeedbackDialog component"
```

---

## Task 8: Wire "Feedback" section into `SettingsPanel`

**Files:**
- Modify: `C:\Users\shenxichen\repos\PLVS\src\components\SettingsPanel.jsx`
- Test: `C:\Users\shenxichen\repos\PLVS\src\components\SettingsPanel.test.jsx`

The dialog is portaled to `document.body` (same pattern as `HoverTip` in `src/components/HoverTip.jsx`) rather than rendered inline, because the Settings sheet's animated wrapper (`motion.div` from Framer Motion) applies a CSS `transform`, which would break `position: fixed` dragging if the dialog were nested inside it — this is also why the existing `ThemeEditor` is mounted at the `App.jsx` level instead of inside `SettingsPanel`. Portaling keeps `FeedbackDialog` self-contained in `SettingsPanel` without threading new props through `App.jsx`.

- [ ] **Step 1: Write the failing test**

Add to `src/components/SettingsPanel.test.jsx` (new `describe` block, or appended `it`s — append after the existing tests, before the closing of the top-level `describe("SettingsPanel", ...)` block):

```jsx
  it("opens the feedback dialog from the Feedback section", () => {
    render(<SettingsPanel {...BASE_PROPS} />);
    expect(screen.queryByRole("dialog", { name: "Send feedback" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Send feedback" }));
    expect(screen.getByRole("dialog", { name: "Send feedback" })).toBeTruthy();
  });

  it("closes the feedback dialog on cancel", () => {
    render(<SettingsPanel {...BASE_PROPS} />);
    fireEvent.click(screen.getByRole("button", { name: "Send feedback" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Send feedback" })).toBeNull();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd C:\Users\shenxichen\repos\PLVS && npx vitest run src/components/SettingsPanel.test.jsx`
Expected: FAIL — `Unable to find role="button" and name "Send feedback"`.

- [ ] **Step 3: Write minimal implementation**

In `src/components/SettingsPanel.jsx`, add two imports (after the existing `import { CHANNEL_ROLE_VOCABULARY } ...` line):

```jsx
import { createPortal } from "react-dom";
import { FeedbackDialog } from "./FeedbackDialog.jsx";
```

Add local state right after the existing `const [sheetBodyVisible, setSheetBodyVisible] = useState(settingsOpen);` line:

```jsx
  const [feedbackOpen, setFeedbackOpen] = useState(false);
```

Insert a new section between the end of the Configuration `SettingsSection` and the `{/* Footer */}` comment. Find this existing boundary:

```jsx
                </SettingsSection>

                {/* Footer */}
```

Replace it with:

```jsx
                </SettingsSection>

                <SettingsDivider />

                {/* Feedback */}
                <SettingsSection>
                  <SettingsRow label="Feedback">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => setFeedbackOpen(true)}
                      aria-label="Send feedback"
                      className="h-7 px-2 text-[length:var(--ui-fs-display)]"
                    >
                      Send Feedback
                    </Button>
                  </SettingsRow>
                </SettingsSection>
                {feedbackOpen
                  ? createPortal(
                      <FeedbackDialog onClose={() => setFeedbackOpen(false)} />,
                      document.body
                    )
                  : null}

                {/* Footer */}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd C:\Users\shenxichen\repos\PLVS && npx vitest run src/components/SettingsPanel.test.jsx`
Expected: PASS, all tests green.

- [ ] **Step 5: Run the full frontend test suite**

Run: `cd C:\Users\shenxichen\repos\PLVS && npx vitest run`
Expected: PASS, no regressions elsewhere.

- [ ] **Step 6: Commit**

```bash
cd C:\Users\shenxichen\repos\PLVS
git add src/components/SettingsPanel.jsx src/components/SettingsPanel.test.jsx
git commit -m "feat: add Feedback section to Settings panel"
```

---

## Task 9: Deploy the backend and do a manual end-to-end smoke test

This task is manual (VPS access is gated by WeChat-QR MFA — SSH cannot be automated; use the Tencent OrcaTerm web terminal) and not part of either repo's automated test suite.

**Files:** none (deployment + manual verification only).

- [ ] **Step 1: Push both repos**

```bash
cd C:\Users\shenxichen\repos\soundoer-newsletter && git push
cd C:\Users\shenxichen\repos\PLVS && git push
```

- [ ] **Step 2: Deploy the backend on the VPS**

In the OrcaTerm web terminal:

```bash
sudo -u ubuntu git -C /home/ubuntu/soundoer-newsletter pull
```

- [ ] **Step 3: Update the VPS `.env`**

Edit `/home/ubuntu/soundoer-newsletter/.env` so `ALLOWED_ORIGIN` becomes the comma-separated list and `FEEDBACK_TO` is set:

```bash
sudo sed -i 's|^ALLOWED_ORIGIN=.*|ALLOWED_ORIGIN=https://plvs.soundoer.com,tauri://localhost,http://tauri.localhost|' /home/ubuntu/soundoer-newsletter/.env
echo 'FEEDBACK_TO=xichen@soundoer.com' | sudo tee -a /home/ubuntu/soundoer-newsletter/.env
```

- [ ] **Step 4: Restart and confirm the service is healthy**

```bash
sudo systemctl restart soundoer-newsletter
sudo systemctl status soundoer-newsletter --no-pager
```

Expected: `Active: active (running)`, no errors in the status output.

- [ ] **Step 5: Smoke-test the endpoint directly with curl**

```bash
curl -i -X POST https://list.plvs.soundoer.com/feedback \
  -H 'Content-Type: application/json' \
  -H 'Origin: tauri://localhost' \
  -d '{"content":"curl smoke test","email":"you@example.com"}'
```

Expected: `HTTP/2 200`, body `{"ok":true}`. Check the maintainer inbox (`xichen@soundoer.com`) for an email with subject "PLVS feedback", body containing "curl smoke test", and confirm hitting Reply on it addresses `you@example.com`.

- [ ] **Step 6: Build PLVS and verify the dialog end-to-end**

On the Windows dev machine:

```bash
cd C:\Users\shenxichen\repos\PLVS
npm run tauri dev
```

In the running app: open Settings → find the "Feedback" section → click "Send Feedback" → drag the dialog by its header to confirm it moves freely → type feedback text and a valid email → click Send → confirm the "Thanks! Feedback sent." message appears and the dialog auto-closes after ~2s. Check the maintainer inbox again for this second message.

- [ ] **Step 7: No commit for this task** — it's deployment and manual verification, not a code change.

---

## Plan Self-Review Notes

- **Spec coverage:** every section of the design spec maps to a task — architecture (Tasks 1–8), frontend component (Task 7), `SettingsPanel` wiring (Task 8), backend route + validation (Tasks 1–3), CORS/CSP config (Tasks 4, 6), error handling (covered by the specific test cases in Tasks 2, 3, 5, 7), deployment (Task 9). The spec's "Testing" section is covered by Tasks 1, 2, 3, 5, 7 rather than a separate task, since each is TDD'd alongside its implementation.
- **Out of scope items from the spec** (no admin UI, no captcha, no attachments, no persistence) require no tasks — confirmed nothing above accidentally implements them.
- **Type/signature consistency checked:** `submitFeedback({ content, email })` (Task 5) is the exact shape `FeedbackDialog` (Task 7) calls it with. `handleFeedback({ content, email, sendFeedback })` (Task 2) is the exact shape `server.js` (Task 3) calls it with, and `sendFeedback`'s `{ content, email }` callback argument matches what `renderFeedbackEmail` (Task 1) expects. `buildServer(...)`'s new `feedbackTo` param (Task 3) matches what `start.js` (Task 4) and `test/server.test.js`'s `setup()` (Task 3) both pass.
