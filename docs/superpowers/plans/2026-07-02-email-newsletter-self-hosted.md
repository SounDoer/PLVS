# Self-Hosted Email Newsletter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a self-hosted email newsletter — a subscribe form on the PLVS landing page, a small Node service on the VPS (double opt-in, one-click unsubscribe, SQLite, send CLI) behind Caddy/systemd, delivering via Amazon SES.

**Architecture:** A standalone Node service owns the subscriber list (SQLite) and exposes three HTTP endpoints (`/subscribe`, `/confirm`, `/unsubscribe`). The static landing page POSTs emails to it over HTTPS. A CLI script renders a Markdown draft and broadcasts it to confirmed subscribers over SMTP. Amazon SES is the SMTP relay; the code targets a standard SMTP interface so the relay can be swapped.

**Tech Stack:** Node.js (ESM), Fastify, better-sqlite3, nodemailer, marked, Caddy, systemd, Amazon SES. Tests use the built-in `node:test` runner + `node:assert`.

---

## Repositories & Paths

Two locations are touched:

1. **New standalone repo `plvs-newsletter`** — the service, deployed to the VPS on its own. All paths in Tasks 1–8 and 11–13 are **relative to this repo's root**.
2. **The existing PLVS repo** — only the landing-page subscribe form. Task 9 uses PLVS-repo paths (`landing/...`).

> The service is intentionally a separate repo so the VPS pulls only it, not the whole Tauri app, and so it stays clear of PLVS's frontend lint/test/build tooling.

## File Structure (service repo)

```
plvs-newsletter/
  package.json
  .env.example
  .gitignore
  src/
    config.js        # env-based config (only imported by start.js + CLI)
    tokens.js        # random token generation
    db.js            # SQLite: open/migrate + subscriber operations
    subscribe.js     # subscribe decision logic + email validation (pure, testable)
    email.js         # SMTP transport + email rendering (confirmation, newsletter)
    draft.js         # parse a Markdown draft into subject + html/text
    server.js        # buildServer(deps) -> Fastify app (pure, no I/O at import)
    start.js         # entrypoint: load config, wire deps, listen
  bin/
    send-newsletter.mjs   # broadcast CLI
  test/
    tokens.test.js
    db.test.js
    subscribe.test.js
    email.test.js
    draft.test.js
    server.test.js
  deploy/
    Caddyfile.example
    plvs-newsletter.service   # systemd unit
  README.md          # deploy + DNS/SES runbook
```

---

## Task 1: Scaffold the standalone project

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `.env.example`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "plvs-newsletter",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "node src/start.js",
    "test": "node --test",
    "send": "node bin/send-newsletter.mjs"
  },
  "dependencies": {
    "@fastify/cors": "^10.0.0",
    "@fastify/rate-limit": "^10.0.0",
    "better-sqlite3": "^11.0.0",
    "dotenv": "^16.4.0",
    "fastify": "^5.0.0",
    "marked": "^14.0.0",
    "nodemailer": "^6.9.0"
  }
}
```

- [ ] **Step 2: Create `.gitignore`**

```gitignore
node_modules/
.env
data/
*.db
*.db-wal
*.db-shm
```

- [ ] **Step 3: Create `.env.example`**

```dotenv
# HTTP
PORT=3000
BASE_URL=https://list.plvs.soundoer.com

# Landing origin allowed to POST /subscribe
ALLOWED_ORIGIN=https://plvs.soundoer.com

# Storage
DATABASE_PATH=./data/subscribers.db

# Amazon SES SMTP credentials (from the SES console)
SMTP_HOST=email-smtp.us-east-1.amazonaws.com
SMTP_PORT=587
SMTP_USER=YOUR_SES_SMTP_USERNAME
SMTP_PASS=YOUR_SES_SMTP_PASSWORD

# Sender identity (domain must be SES-verified with DKIM)
FROM_EMAIL=newsletter@soundoer.com
FROM_NAME=PLVS

# Footer contact line (recommended for CAN-SPAM)
CONTACT_ADDRESS=
```

- [ ] **Step 4: Install dependencies**

Run: `npm install`
Expected: `node_modules/` created, no errors. (better-sqlite3 compiles a native binding; on the VPS this needs build tools — see README runbook.)

- [ ] **Step 5: Commit**

```bash
git init
git add package.json .gitignore .env.example
git commit -m "chore: scaffold plvs-newsletter service"
```

---

## Task 2: Token generation

**Files:**
- Create: `src/tokens.js`
- Test: `test/tokens.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateToken } from "../src/tokens.js";

test("generateToken returns a long url-safe string", () => {
  const t = generateToken();
  assert.match(t, /^[A-Za-z0-9_-]+$/);
  assert.ok(t.length >= 24);
});

test("generateToken returns distinct values", () => {
  assert.notEqual(generateToken(), generateToken());
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/tokens.test.js`
Expected: FAIL — cannot find module `../src/tokens.js`.

- [ ] **Step 3: Write minimal implementation**

`src/tokens.js`:

```js
import { randomBytes } from "node:crypto";

export function generateToken() {
  return randomBytes(24).toString("base64url");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/tokens.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/tokens.js test/tokens.test.js
git commit -m "feat: add random token generation"
```

---

## Task 3: Database layer

**Files:**
- Create: `src/db.js`
- Test: `test/db.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  openDb,
  getByEmail,
  getByToken,
  upsertPending,
  confirm,
  unsubscribe,
  listConfirmed,
} from "../src/db.js";

function freshDb() {
  return openDb(":memory:");
}

test("upsertPending inserts a pending subscriber", () => {
  const db = freshDb();
  const row = upsertPending(db, "a@example.com", "tok-a");
  assert.equal(row.email, "a@example.com");
  assert.equal(row.status, "pending");
  assert.equal(row.token, "tok-a");
  assert.ok(row.created_at);
});

test("confirm flips status to confirmed and records time", () => {
  const db = freshDb();
  upsertPending(db, "a@example.com", "tok-a");
  const row = confirm(db, "tok-a");
  assert.equal(row.status, "confirmed");
  assert.ok(row.confirmed_at);
});

test("confirm with an unknown token returns null", () => {
  const db = freshDb();
  assert.equal(confirm(db, "nope"), null);
});

test("unsubscribe flips status to unsubscribed", () => {
  const db = freshDb();
  upsertPending(db, "a@example.com", "tok-a");
  confirm(db, "tok-a");
  const row = unsubscribe(db, "tok-a");
  assert.equal(row.status, "unsubscribed");
  assert.ok(row.unsubscribed_at);
});

test("upsertPending re-subscribes a previously unsubscribed email with a fresh token", () => {
  const db = freshDb();
  upsertPending(db, "a@example.com", "tok-a");
  confirm(db, "tok-a");
  unsubscribe(db, "tok-a");
  const row = upsertPending(db, "a@example.com", "tok-b");
  assert.equal(row.status, "pending");
  assert.equal(row.token, "tok-b");
  assert.equal(row.unsubscribed_at, null);
  assert.equal(getByEmail(db, "a@example.com").token, "tok-b");
  assert.equal(getByToken(db, "tok-b").email, "a@example.com");
});

test("listConfirmed returns only confirmed subscribers", () => {
  const db = freshDb();
  upsertPending(db, "pending@example.com", "t1");
  upsertPending(db, "confirmed@example.com", "t2");
  confirm(db, "t2");
  const rows = listConfirmed(db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].email, "confirmed@example.com");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/db.test.js`
Expected: FAIL — cannot find module `../src/db.js`.

- [ ] **Step 3: Write minimal implementation**

`src/db.js`:

```js
import Database from "better-sqlite3";

export function openDb(path) {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS subscribers (
      email TEXT PRIMARY KEY,
      status TEXT NOT NULL CHECK (status IN ('pending','confirmed','unsubscribed')),
      token TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      confirmed_at TEXT,
      unsubscribed_at TEXT
    );
  `);
  return db;
}

export function getByEmail(db, email) {
  return db.prepare("SELECT * FROM subscribers WHERE email = ?").get(email) ?? null;
}

export function getByToken(db, token) {
  return db.prepare("SELECT * FROM subscribers WHERE token = ?").get(token) ?? null;
}

export function upsertPending(db, email, token, now = new Date().toISOString()) {
  db.prepare(`
    INSERT INTO subscribers (email, status, token, created_at)
    VALUES (?, 'pending', ?, ?)
    ON CONFLICT(email) DO UPDATE SET
      status = 'pending',
      token = excluded.token,
      created_at = excluded.created_at,
      confirmed_at = NULL,
      unsubscribed_at = NULL
  `).run(email, token, now);
  return getByEmail(db, email);
}

export function confirm(db, token, now = new Date().toISOString()) {
  if (!getByToken(db, token)) return null;
  db.prepare("UPDATE subscribers SET status = 'confirmed', confirmed_at = ? WHERE token = ?").run(now, token);
  return getByToken(db, token);
}

export function unsubscribe(db, token, now = new Date().toISOString()) {
  if (!getByToken(db, token)) return null;
  db.prepare("UPDATE subscribers SET status = 'unsubscribed', unsubscribed_at = ? WHERE token = ?").run(now, token);
  return getByToken(db, token);
}

export function listConfirmed(db) {
  return db.prepare("SELECT * FROM subscribers WHERE status = 'confirmed' ORDER BY confirmed_at").all();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/db.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/db.js test/db.test.js
git commit -m "feat: add SQLite subscriber store"
```

---

## Task 4: Subscribe decision logic

**Files:**
- Create: `src/subscribe.js`
- Test: `test/subscribe.test.js`

This is the pure logic behind `POST /subscribe`, decoupled from HTTP and SMTP. `sendConfirmation(email, token)` is injected so tests can record calls.

- [ ] **Step 1: Write the failing test**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb, getByEmail, confirm } from "../src/db.js";
import { isValidEmail, handleSubscribe } from "../src/subscribe.js";

function setup() {
  const db = openDb(":memory:");
  const sent = [];
  const sendConfirmation = async (email, token) => sent.push({ email, token });
  return { db, sent, sendConfirmation };
}

test("isValidEmail accepts and rejects", () => {
  assert.ok(isValidEmail("a@b.com"));
  assert.ok(!isValidEmail("nope"));
  assert.ok(!isValidEmail(""));
  assert.ok(!isValidEmail(undefined));
});

test("new email becomes pending and gets a confirmation", async () => {
  const { db, sent, sendConfirmation } = setup();
  const res = await handleSubscribe({ db, sendConfirmation, email: "a@example.com" });
  assert.equal(res.status, "pending");
  assert.equal(getByEmail(db, "a@example.com").status, "pending");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].email, "a@example.com");
});

test("honeypot fill is silently ignored (no db write, no email)", async () => {
  const { db, sent, sendConfirmation } = setup();
  const res = await handleSubscribe({ db, sendConfirmation, email: "a@example.com", honeypot: "http://spam" });
  assert.equal(res.status, "ignored");
  assert.equal(getByEmail(db, "a@example.com"), null);
  assert.equal(sent.length, 0);
});

test("invalid email is rejected without sending", async () => {
  const { db, sent, sendConfirmation } = setup();
  const res = await handleSubscribe({ db, sendConfirmation, email: "nope" });
  assert.equal(res.status, "invalid");
  assert.equal(sent.length, 0);
});

test("already-confirmed email does not resend or change state", async () => {
  const { db, sent, sendConfirmation } = setup();
  await handleSubscribe({ db, sendConfirmation, email: "a@example.com" });
  const token = getByEmail(db, "a@example.com").token;
  confirm(db, token);
  sent.length = 0;
  const res = await handleSubscribe({ db, sendConfirmation, email: "a@example.com" });
  assert.equal(res.status, "already");
  assert.equal(getByEmail(db, "a@example.com").status, "confirmed");
  assert.equal(sent.length, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/subscribe.test.js`
Expected: FAIL — cannot find module `../src/subscribe.js`.

- [ ] **Step 3: Write minimal implementation**

`src/subscribe.js`:

```js
import { generateToken } from "./tokens.js";
import { getByEmail, upsertPending } from "./db.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email) {
  return typeof email === "string" && EMAIL_RE.test(email);
}

export async function handleSubscribe({ db, sendConfirmation, email, honeypot }) {
  if (honeypot) return { status: "ignored" };
  if (!isValidEmail(email)) return { status: "invalid" };

  const existing = getByEmail(db, email);
  if (existing && existing.status === "confirmed") {
    return { status: "already" };
  }

  const token = generateToken();
  const row = upsertPending(db, email, token);
  await sendConfirmation(row.email, row.token);
  return { status: "pending" };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/subscribe.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/subscribe.js test/subscribe.test.js
git commit -m "feat: add subscribe decision logic with honeypot"
```

---

## Task 5: Email rendering

**Files:**
- Create: `src/email.js`
- Test: `test/email.test.js`

Render functions are pure (no network). `createTransport`/`sendMail` are thin SMTP wrappers verified manually in the deploy runbook.

- [ ] **Step 1: Write the failing test**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderConfirmationEmail, renderNewsletter } from "../src/email.js";

test("confirmation email contains a confirm link with the token", () => {
  const msg = renderConfirmationEmail({ baseUrl: "https://list.example.com", token: "abc", fromName: "PLVS" });
  assert.match(msg.subject, /confirm/i);
  assert.ok(msg.html.includes("https://list.example.com/confirm?token=abc"));
  assert.ok(msg.text.includes("https://list.example.com/confirm?token=abc"));
});

test("newsletter appends an unsubscribe link and List-Unsubscribe headers", () => {
  const msg = renderNewsletter({
    subject: "Hello",
    bodyHtml: "<p>body</p>",
    bodyText: "body",
    baseUrl: "https://list.example.com",
    token: "xyz",
    fromName: "PLVS",
    contactAddress: "123 Main St",
  });
  assert.equal(msg.subject, "Hello");
  assert.ok(msg.html.includes("<p>body</p>"));
  assert.ok(msg.html.includes("https://list.example.com/unsubscribe?token=xyz"));
  assert.ok(msg.html.includes("123 Main St"));
  assert.equal(msg.headers["List-Unsubscribe"], "<https://list.example.com/unsubscribe?token=xyz>");
  assert.equal(msg.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/email.test.js`
Expected: FAIL — cannot find module `../src/email.js`.

- [ ] **Step 3: Write minimal implementation**

`src/email.js`:

```js
import nodemailer from "nodemailer";

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

export function createTransport(smtp) {
  return nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.port === 465,
    auth: { user: smtp.user, pass: smtp.pass },
  });
}

export function renderConfirmationEmail({ baseUrl, token, fromName }) {
  const url = `${baseUrl}/confirm?token=${encodeURIComponent(token)}`;
  return {
    subject: `Confirm your ${fromName} subscription`,
    text: `Please confirm your subscription to ${fromName}:\n\n${url}\n\nIf you didn't request this, ignore this email.`,
    html: `<p>Please confirm your subscription to ${escapeHtml(fromName)}:</p>
<p><a href="${url}">Confirm subscription</a></p>
<p>If you didn't request this, you can ignore this email.</p>`,
  };
}

export function renderNewsletter({ subject, bodyHtml, bodyText, baseUrl, token, fromName, contactAddress }) {
  const unsubUrl = `${baseUrl}/unsubscribe?token=${encodeURIComponent(token)}`;
  const addressHtml = contactAddress ? `<br>${escapeHtml(contactAddress)}` : "";
  const addressText = contactAddress ? `\n${contactAddress}` : "";
  return {
    subject,
    html: `${bodyHtml}
<hr>
<p style="font-size:12px;color:#888">You're receiving this because you subscribed to ${escapeHtml(fromName)}.<br><a href="${unsubUrl}">Unsubscribe</a>${addressHtml}</p>`,
    text: `${bodyText}\n\n---\nYou're receiving this because you subscribed to ${fromName}.\nUnsubscribe: ${unsubUrl}${addressText}`,
    headers: {
      "List-Unsubscribe": `<${unsubUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };
}

export function createSendMail(transport) {
  return (message) => transport.sendMail(message);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/email.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/email.js test/email.test.js
git commit -m "feat: add email rendering and SMTP transport"
```

---

## Task 6: HTTP server (buildServer)

**Files:**
- Create: `src/server.js`
- Test: `test/server.test.js`

`buildServer(deps)` returns a Fastify app with no side effects at import, tested via `app.inject()` (no real port, no real SMTP). CORS and rate-limiting are wired in the entrypoint (Task 7), not here.

- [ ] **Step 1: Write the failing test**

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
  });
  return { db, sent, app };
}

test("POST /subscribe stores pending and sends confirmation", async () => {
  const { db, sent, app } = setup();
  const res = await app.inject({ method: "POST", url: "/subscribe", payload: { email: "a@example.com" } });
  assert.equal(res.statusCode, 200);
  assert.equal(getByEmail(db, "a@example.com").status, "pending");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "a@example.com");
  assert.match(sent[0].html, /\/confirm\?token=/);
  await app.close();
});

test("POST /subscribe with honeypot returns 200 but writes nothing", async () => {
  const { db, sent, app } = setup();
  const res = await app.inject({ method: "POST", url: "/subscribe", payload: { email: "a@example.com", website: "x" } });
  assert.equal(res.statusCode, 200);
  assert.equal(getByEmail(db, "a@example.com"), null);
  assert.equal(sent.length, 0);
  await app.close();
});

test("POST /subscribe with invalid email returns 400", async () => {
  const { app } = setup();
  const res = await app.inject({ method: "POST", url: "/subscribe", payload: { email: "nope" } });
  assert.equal(res.statusCode, 400);
  await app.close();
});

test("GET /confirm activates a pending subscriber", async () => {
  const { db, app } = setup();
  await app.inject({ method: "POST", url: "/subscribe", payload: { email: "a@example.com" } });
  const token = getByEmail(db, "a@example.com").token;
  const res = await app.inject({ method: "GET", url: `/confirm?token=${token}` });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /confirmed/i);
  assert.equal(getByEmail(db, "a@example.com").status, "confirmed");
  await app.close();
});

test("GET /confirm with bad token returns 404", async () => {
  const { app } = setup();
  const res = await app.inject({ method: "GET", url: "/confirm?token=nope" });
  assert.equal(res.statusCode, 404);
  await app.close();
});

test("GET and POST /unsubscribe both unsubscribe", async () => {
  for (const method of ["GET", "POST"]) {
    const { db, app } = setup();
    await app.inject({ method: "POST", url: "/subscribe", payload: { email: "a@example.com" } });
    const token = getByEmail(db, "a@example.com").token;
    const res = await app.inject({ method, url: `/unsubscribe?token=${token}` });
    assert.equal(res.statusCode, 200);
    assert.equal(getByEmail(db, "a@example.com").status, "unsubscribed");
    await app.close();
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/server.test.js`
Expected: FAIL — cannot find module `../src/server.js`.

- [ ] **Step 3: Write minimal implementation**

`src/server.js`:

```js
import Fastify from "fastify";
import { handleSubscribe } from "./subscribe.js";
import { confirm, unsubscribe } from "./db.js";
import { renderConfirmationEmail } from "./email.js";

function page(message) {
  return `<!doctype html><meta charset="utf-8"><title>PLVS</title>
<body style="font-family:sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem">
<p>${message}</p></body>`;
}

export function buildServer({ db, sendMail, baseUrl, fromEmail, fromName }) {
  const app = Fastify({ logger: false });

  app.post("/subscribe", async (req, reply) => {
    const { email, website } = req.body ?? {};
    const result = await handleSubscribe({
      db,
      email,
      honeypot: website,
      sendConfirmation: async (to, token) => {
        const msg = renderConfirmationEmail({ baseUrl, token, fromName });
        await sendMail({ from: `${fromName} <${fromEmail}>`, to, ...msg });
      },
    });
    if (result.status === "invalid") {
      return reply.code(400).send({ ok: false, error: "invalid email" });
    }
    return reply.code(200).send({ ok: true, message: "Check your inbox to confirm your subscription." });
  });

  app.get("/confirm", async (req, reply) => {
    const token = req.query?.token;
    const row = token ? confirm(db, token) : null;
    if (!row) return reply.code(404).type("text/html").send(page("Invalid or expired confirmation link."));
    return reply.type("text/html").send(page("Subscription confirmed \u{1F389} You're on the list."));
  });

  const doUnsubscribe = (req, reply) => {
    const token = req.query?.token;
    const row = token ? unsubscribe(db, token) : null;
    if (!row) return reply.code(404).type("text/html").send(page("Invalid unsubscribe link."));
    return reply.type("text/html").send(page("You've been unsubscribed."));
  };
  app.get("/unsubscribe", doUnsubscribe);
  app.post("/unsubscribe", doUnsubscribe);

  return app;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/server.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server.js test/server.test.js
git commit -m "feat: add subscribe/confirm/unsubscribe HTTP endpoints"
```

---

## Task 7: Config + entrypoint (CORS, rate limit, listen)

**Files:**
- Create: `src/config.js`
- Create: `src/start.js`

No unit test — this is I/O wiring, verified by starting the server (Step 4).

- [ ] **Step 1: Write `src/config.js`**

```js
import "dotenv/config";

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  baseUrl: required("BASE_URL"),
  allowedOrigin: required("ALLOWED_ORIGIN"),
  databasePath: process.env.DATABASE_PATH ?? "./data/subscribers.db",
  smtp: {
    host: required("SMTP_HOST"),
    port: Number(process.env.SMTP_PORT ?? 587),
    user: required("SMTP_USER"),
    pass: required("SMTP_PASS"),
  },
  fromEmail: required("FROM_EMAIL"),
  fromName: process.env.FROM_NAME ?? "PLVS",
  contactAddress: process.env.CONTACT_ADDRESS ?? "",
};
```

- [ ] **Step 2: Write `src/start.js`**

```js
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { config } from "./config.js";
import { openDb } from "./db.js";
import { createTransport, createSendMail } from "./email.js";
import { buildServer } from "./server.js";

mkdirSync(dirname(config.databasePath), { recursive: true });

const db = openDb(config.databasePath);
const transport = createTransport(config.smtp);
const sendMail = createSendMail(transport);

const app = buildServer({
  db,
  sendMail,
  baseUrl: config.baseUrl,
  fromEmail: config.fromEmail,
  fromName: config.fromName,
});

await app.register(cors, { origin: config.allowedOrigin, methods: ["POST"] });
await app.register(rateLimit, {
  max: 5,
  timeWindow: "1 minute",
  allowList: [],
});

try {
  await app.listen({ port: config.port, host: "127.0.0.1" });
  console.log(`plvs-newsletter listening on 127.0.0.1:${config.port}`);
} catch (err) {
  console.error(err);
  process.exit(1);
}
```

> Note: binds to `127.0.0.1`; Caddy terminates TLS on the public interface and proxies to it. Rate limit is global here for simplicity; it protects `/subscribe` from casual abuse alongside the honeypot.

- [ ] **Step 3: Verify config loads and rejects missing vars**

Run: `node -e "import('./src/config.js').then(()=>console.log('ok')).catch(e=>console.log('threw:',e.message))"`
Expected: prints `threw: Missing required env var: BASE_URL` (no `.env` yet). Then `cp .env.example .env` and re-run: prints `ok`.

- [ ] **Step 4: Verify the server boots**

Run: `npm start`
Expected: logs `plvs-newsletter listening on 127.0.0.1:3000`. Stop with Ctrl+C. (SMTP is not contacted until a subscribe happens, so boot works with placeholder SES creds.)

- [ ] **Step 5: Commit**

```bash
git add src/config.js src/start.js
git commit -m "feat: add config and server entrypoint with CORS and rate limit"
```

---

## Task 8: Draft parsing

**Files:**
- Create: `src/draft.js`
- Test: `test/draft.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDraft } from "../src/draft.js";

test("parseDraft extracts subject and renders markdown body", () => {
  const raw = "Subject: Hello World\n\n# Heading\n\nSome **bold** text.";
  const { subject, bodyHtml, bodyText } = parseDraft(raw);
  assert.equal(subject, "Hello World");
  assert.match(bodyHtml, /<h1[^>]*>Heading<\/h1>/);
  assert.match(bodyHtml, /<strong>bold<\/strong>/);
  assert.ok(bodyText.includes("# Heading"));
});

test("parseDraft throws without a Subject line", () => {
  assert.throws(() => parseDraft("no subject here"), /Subject:/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/draft.test.js`
Expected: FAIL — cannot find module `../src/draft.js`.

- [ ] **Step 3: Write minimal implementation**

`src/draft.js`:

```js
import { marked } from "marked";

export function parseDraft(raw) {
  const lines = raw.split(/\r?\n/);
  const match = (lines[0] ?? "").match(/^Subject:\s*(.+)$/);
  if (!match) throw new Error("Draft must start with a 'Subject: <title>' line");
  const subject = match[1].trim();
  const body = lines.slice(1).join("\n").trim();
  return { subject, bodyText: body, bodyHtml: marked.parse(body) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/draft.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/draft.js test/draft.test.js
git commit -m "feat: add markdown draft parsing"
```

---

## Task 9: Broadcast CLI

**Files:**
- Create: `bin/send-newsletter.mjs`

Composed from tested pieces (`parseDraft`, `renderNewsletter`, `listConfirmed`, `createSendMail`). The I/O loop is verified via `--dry-run` (Step 3) rather than a unit test.

- [ ] **Step 1: Write `bin/send-newsletter.mjs`**

```js
#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { config } from "../src/config.js";
import { openDb, listConfirmed } from "../src/db.js";
import { parseDraft } from "../src/draft.js";
import { renderNewsletter, createTransport, createSendMail } from "../src/email.js";

function parseArgs(argv) {
  const args = { dryRun: false, test: null, file: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") args.dryRun = true;
    else if (a === "--test") args.test = argv[++i];
    else if (!a.startsWith("--")) args.file = a;
  }
  return args;
}

async function confirmPrompt(question) {
  const rl = createInterface({ input: stdin, output: stdout });
  const answer = await rl.question(question);
  rl.close();
  return answer.trim().toLowerCase() === "yes";
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.file) {
    console.error("Usage: send-newsletter <draft.md> [--test you@example.com] [--dry-run]");
    process.exit(1);
  }

  const { subject, bodyHtml, bodyText } = parseDraft(readFileSync(args.file, "utf8"));

  const db = openDb(config.databasePath);
  const from = `${config.fromName} <${config.fromEmail}>`;

  // Recipients: real subscribers, or a single --test address (with a throwaway token).
  const recipients = args.test
    ? [{ email: args.test, token: "test-preview-token" }]
    : listConfirmed(db);

  if (recipients.length === 0) {
    console.log("No recipients. (No confirmed subscribers, or missing --test address.)");
    return;
  }

  console.log(`Subject: ${subject}`);
  console.log(`Recipients: ${recipients.length}${args.dryRun ? " (dry run)" : ""}${args.test ? " (test)" : ""}`);

  if (args.dryRun) {
    const preview = renderNewsletter({
      subject, bodyHtml, bodyText,
      baseUrl: config.baseUrl, token: recipients[0].token,
      fromName: config.fromName, contactAddress: config.contactAddress,
    });
    console.log("\n--- HTML preview ---\n" + preview.html);
    return;
  }

  if (!args.test) {
    const ok = await confirmPrompt(`About to send to ${recipients.length} people. Type "yes" to continue: `);
    if (!ok) { console.log("Aborted."); return; }
  }

  const sendMail = createSendMail(createTransport(config.smtp));
  let sent = 0;
  const failed = [];
  for (const r of recipients) {
    const msg = renderNewsletter({
      subject, bodyHtml, bodyText,
      baseUrl: config.baseUrl, token: r.token,
      fromName: config.fromName, contactAddress: config.contactAddress,
    });
    try {
      await sendMail({ from, to: r.email, subject: msg.subject, html: msg.html, text: msg.text, headers: msg.headers });
      sent++;
      process.stdout.write(`\rsent ${sent} / ${recipients.length} ...`);
    } catch (err) {
      failed.push({ email: r.email, error: err.message });
    }
  }
  console.log(`\nDone. Sent ${sent}, failed ${failed.length}.`);
  if (failed.length) console.log(failed);
}

main().catch((err) => { console.error(err); process.exit(1); });
```

- [ ] **Step 2: Create a sample draft for verification**

Create `draft-example.md`:

```markdown
Subject: PLVS test broadcast

Hello,

This is a **test** of the PLVS newsletter.
```

- [ ] **Step 3: Verify dry-run renders without sending**

Run: `node bin/send-newsletter.mjs draft-example.md --dry-run`
Expected: prints the subject, a recipient count, and an HTML preview that includes an `/unsubscribe?token=` link. No SMTP contact.

- [ ] **Step 4: Commit**

```bash
git add bin/send-newsletter.mjs draft-example.md
git commit -m "feat: add newsletter broadcast CLI"
```

---

## Task 10: Landing-page subscribe form (PLVS repo)

**Files (in the PLVS repo, not the service repo):**
- Modify: `landing/index.html`
- Modify: `landing/index.test.js`

- [ ] **Step 1: Add failing tests to `landing/index.test.js`**

Append this block:

```js
describe("landing page subscribe form", () => {
  test("posts to the newsletter service with a honeypot field", () => {
    expect(html).toContain('id="subscribe-form"');
    expect(html).toContain("https://list.plvs.soundoer.com/subscribe");
    expect(html).toContain('name="email"');
    // Honeypot: named "website", visually hidden, aria-hidden.
    expect(html).toContain('name="website"');
    expect(html).toContain("subscribe-honeypot");
  });

  test("keeps the double opt-in expectation in the copy", () => {
    expect(html).toContain("Check your inbox to confirm");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from PLVS repo root): `npx vitest run landing/index.test.js`
Expected: FAIL — the new assertions don't match yet.

- [ ] **Step 3: Add the form markup + styles + script to `landing/index.html`**

Add these style rules inside the existing `<style>` block (near the other component styles):

```css
      .subscribe {
        max-width: 32rem;
        margin: 0 auto;
      }
      .subscribe-form {
        display: flex;
        gap: 0.5rem;
      }
      .subscribe-form input[type="email"] {
        flex: 1;
        padding: 0.7rem 0.9rem;
        border-radius: var(--radius);
        border: 1px solid var(--line);
        background: var(--panel);
        color: var(--ink);
        font: inherit;
      }
      .subscribe-form button {
        padding: 0.7rem 1.1rem;
        border-radius: var(--radius);
        border: none;
        background: var(--accent);
        color: var(--accent-ink);
        font: inherit;
        cursor: pointer;
      }
      .subscribe-honeypot {
        position: absolute;
        left: -9999px;
        width: 1px;
        height: 1px;
        overflow: hidden;
      }
      .subscribe-status {
        margin-top: 0.6rem;
        color: var(--muted);
        min-height: 1.2em;
      }
```

Add this section to the page body (place it before the site footer):

```html
        <section class="subscribe" id="subscribe">
          <h2>Stay in the loop</h2>
          <p>Get an email when a new PLVS release ships. No spam, unsubscribe anytime.</p>
          <form class="subscribe-form" id="subscribe-form">
            <input type="email" name="email" required placeholder="you@example.com" aria-label="Email address" />
            <div class="subscribe-honeypot" aria-hidden="true">
              <label>Leave this empty<input type="text" name="website" tabindex="-1" autocomplete="off" /></label>
            </div>
            <button type="submit">Subscribe</button>
          </form>
          <p class="subscribe-status" id="subscribe-status" role="status"></p>
        </section>
        <script>
          (function () {
            var form = document.getElementById("subscribe-form");
            var status = document.getElementById("subscribe-status");
            if (!form) return;
            form.addEventListener("submit", function (event) {
              event.preventDefault();
              status.textContent = "Sending...";
              var data = new FormData(form);
              fetch("https://list.plvs.soundoer.com/subscribe", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  email: data.get("email"),
                  website: data.get("website"),
                }),
              })
                .then(function (res) {
                  if (res.status === 400) throw new Error("Please enter a valid email address.");
                  if (!res.ok) throw new Error("Something went wrong. Please try again later.");
                  form.reset();
                  status.textContent = "Check your inbox to confirm your subscription.";
                })
                .catch(function (err) {
                  status.textContent = err.message;
                });
            });
          })();
        </script>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run landing/index.test.js`
Expected: PASS, including the two new tests.

- [ ] **Step 5: Commit (PLVS repo)**

```bash
git add landing/index.html landing/index.test.js
git commit -m "feat(landing): add newsletter subscribe form"
```

> `Content-Type: application/json` on the POST makes this a CORS non-simple request, so the browser sends a preflight `OPTIONS`. `@fastify/cors` (Task 7) answers it automatically for the allowed origin.

---

## Task 11: Deployment artifacts (Caddy + systemd)

**Files (service repo):**
- Create: `deploy/Caddyfile.example`
- Create: `deploy/plvs-newsletter.service`

No automated test — validated during the deploy runbook (Task 13).

- [ ] **Step 1: Create `deploy/Caddyfile.example`**

```caddyfile
# /etc/caddy/Caddyfile — Caddy auto-provisions a Let's Encrypt cert for this host.
list.plvs.soundoer.com {
    reverse_proxy 127.0.0.1:3000
}
```

- [ ] **Step 2: Create `deploy/plvs-newsletter.service`**

```ini
[Unit]
Description=PLVS newsletter service
After=network.target

[Service]
Type=simple
# Adjust User and WorkingDirectory to your deployment.
User=plvs
WorkingDirectory=/opt/plvs-newsletter
EnvironmentFile=/opt/plvs-newsletter/.env
ExecStart=/usr/bin/node src/start.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 3: Commit**

```bash
git add deploy/Caddyfile.example deploy/plvs-newsletter.service
git commit -m "chore: add Caddy and systemd deployment artifacts"
```

---

## Task 12: README runbook

**Files (service repo):**
- Create: `README.md`

- [ ] **Step 1: Write `README.md`**

````markdown
# plvs-newsletter

Self-hosted newsletter service for PLVS. Owns the subscriber list (SQLite) and
sends broadcasts via Amazon SES over SMTP. See the design spec in the PLVS repo:
`docs/superpowers/specs/2026-07-02-email-newsletter-self-hosted-design.md`.

## Local development

```bash
npm install
cp .env.example .env   # fill in SES SMTP creds; placeholders are fine for boot
npm test               # node --test
npm start              # boots on 127.0.0.1:3000
```

## Sending a newsletter

1. Write a Markdown draft; the first line must be `Subject: <title>`.
2. Preview to your own inbox: `node bin/send-newsletter.mjs draft.md --test you@example.com`
3. Broadcast: `node bin/send-newsletter.mjs draft.md` (type `yes` at the prompt).

`--dry-run` renders the HTML without sending. Ctrl+C stops mid-broadcast.

## One-time DNS + SES setup (on `soundoer.com`)

Deliverability depends entirely on these. Do them before broadcasting.

1. **Verify the domain in SES** (SES console → Verified identities → create
   identity for `soundoer.com`). Enable **Easy DKIM**; SES gives 3 CNAME records
   — add them to `soundoer.com` DNS. Wait for "verified".
2. **Custom MAIL FROM**: set `mail.soundoer.com` as the MAIL FROM domain in SES;
   add the MX + SPF TXT records SES provides. This aligns SPF to your domain so
   DMARC passes.
3. **DMARC**: add a TXT record at `_dmarc.soundoer.com`:
   `v=DMARC1; p=none; rua=mailto:you@soundoer.com` (start at `p=none`, tighten later).
4. **SMTP credentials**: SES console → SMTP settings → create SMTP credentials.
   Put them in `.env` (`SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`).
5. **Leave the SES sandbox**: request production access (SES console → Account
   dashboard → Request production access), describing the use case (own product
   newsletter). Until approved you can only send to verified addresses — use that
   window to test with `--test`.
6. **Service subdomain**: add an A record `list.plvs.soundoer.com` → VPS IP.

## VPS deployment

Prerequisites: Node.js LTS, build tools for the `better-sqlite3` native binding
(`build-essential python3` on Debian/Ubuntu), and Caddy installed.

```bash
sudo git clone <repo-url> /opt/plvs-newsletter
cd /opt/plvs-newsletter
sudo npm ci --omit=dev
sudo cp .env.example .env && sudo nano .env    # fill in real values
sudo cp deploy/Caddyfile.example /etc/caddy/Caddyfile && sudo systemctl reload caddy
sudo cp deploy/plvs-newsletter.service /etc/systemd/system/
sudo useradd --system plvs 2>/dev/null || true
sudo chown -R plvs /opt/plvs-newsletter
sudo systemctl enable --now plvs-newsletter
```

## Backups

The entire dataset is one SQLite file (`DATABASE_PATH`). Back it up with a cron
copy, e.g. `sqlite3 data/subscribers.db ".backup /backups/subscribers-$(date +%F).db"`.
````

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add deploy and SES setup runbook"
```

---

## Task 13: End-to-end verification (manual)

No code. Run after Task 12 with SES configured and out of the sandbox (or with a
verified test address while still sandboxed).

- [ ] **Step 1:** From `plvs.soundoer.com`, submit your own email in the form. Expect the "Check your inbox to confirm" status message.
- [ ] **Step 2:** Receive the confirmation email; click the confirm link. Expect the "Subscription confirmed" page. Verify the row is `confirmed` in SQLite (`sqlite3 data/subscribers.db "select email,status from subscribers"`).
- [ ] **Step 3:** Broadcast a test draft (`node bin/send-newsletter.mjs draft.md --test you@example.com`). Verify it arrives **in the inbox, not spam**, and inspect headers: `DKIM=pass`, `SPF=pass`, `DMARC=pass`.
- [ ] **Step 4:** Click the unsubscribe link in the received newsletter. Expect the "unsubscribed" page and `status = unsubscribed` in SQLite.
- [ ] **Step 5:** Confirm Gmail shows a native "Unsubscribe" control near the sender (verifies the `List-Unsubscribe` headers).

---

## Self-Review Notes

- **Spec coverage:** architecture/domains → Tasks 6–7, 10; double opt-in → Tasks 4–6; one-click unsubscribe + headers → Tasks 5–6, 13; SQLite model → Task 3; Node/Caddy/systemd/SQLite stack → Tasks 1, 7, 11–12; endpoints → Task 6; send CLI + safety switches → Task 9; deliverability/DNS → Task 12; anti-spam (honeypot + rate limit) → Tasks 4, 7, 10; compliance footer → Task 5; landing form → Task 10; success criteria → Task 13.
- **Naming consistency:** `openDb`, `getByEmail`, `getByToken`, `upsertPending`, `confirm`, `unsubscribe`, `listConfirmed`, `handleSubscribe`, `renderConfirmationEmail`, `renderNewsletter`, `createTransport`, `createSendMail`, `buildServer`, `parseDraft` are used identically across tasks. `sendMail` is the injected `(message) => Promise` throughout; `sendConfirmation(email, token)` is the subscribe-layer callback.
- **Out-of-scope items** (web admin, tracking, resume/dedup, styled pages, segments) are deliberately excluded per the spec.
```