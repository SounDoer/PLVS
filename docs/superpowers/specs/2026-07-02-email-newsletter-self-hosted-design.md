# Self-Hosted Email Newsletter

**Date:** 2026-07-02
**Status:** Draft

## Summary

Add an email newsletter capability for PLVS: let visitors subscribe from the
landing page and let the maintainer send occasional broadcast emails (release
notes, changelogs, tutorials) to confirmed subscribers.

The subscriber list, subscription pages, and sending logic are **self-hosted**
on the maintainer's own VPS at near-zero cost, with all data owned locally. Only
the final "put the mail on the wire" step is delegated to **Amazon SES**, a
low-cost transactional relay, to guarantee inbox deliverability. Everything is
written against a standard SMTP interface, so the relay can be swapped (e.g. to
Brevo) by changing a few config values.

This is a **separate service** from the PLVS Tauri/Rust app. It shares nothing
with the app's codebase beyond living in the same repository conceptually; it is
independently deployed and operated.

## Motivation

The PLVS landing page (`landing/`, a static site hosted on GitHub Pages at
`plvs.soundoer.com`) has no way to notify interested users about new releases.
The goal is a low-maintenance, low-cost way to build an opt-in audience and send
them occasional updates.

Constraints from the maintainer:

- Avoid paid SaaS newsletter products where possible (cost).
- Prefer self-hosting on an already-owned domain (`soundoer.com`) and VPS.

The hard part of running a newsletter is **outbound deliverability**, not
collecting addresses. Self-hosting an SMTP server on a VPS fights IP-reputation
blocklists, blocked port 25, and spam filtering, and lands in spam by default.
The chosen approach keeps the list and app self-hosted but borrows a reputable
relay (SES) for the send, resolving the "free vs. actually delivered" conflict.

## Scale Assumptions

Small, at least initially: hundreds of subscribers, infrequent sends (e.g. on
release). Well within SES's low-volume pricing (~$0.10 / 1,000 emails; free for
the first 12 months up to 3,000/month). Design choices favor simplicity over
scale; nothing here should preclude growing to tens of thousands later.

## Architecture

```
                    ┌─────────────────────────────┐
  Visitor           │  Static landing (GitHub Pages)│
  browser  ────────▶│  plvs.soundoer.com + <form>  │
                    └───────────────┬─────────────┘
                                    │ POST email (HTTPS)
                                    ▼
              ┌──────────────────────────────────────┐
              │   VPS: small Node service              │
              │   (list.plvs.soundoer.com)             │
              │                                        │
              │  · POST /subscribe   store + confirm   │
              │  · GET  /confirm     double opt-in     │
              │  · GET  /unsubscribe one-click unsub   │
              │  · SQLite subscriber list              │
              │  · CLI: send-newsletter draft.md       │
              └───────────────────┬────────────────────┘
                                  │ SMTP (standard)
                                  ▼
                      ┌───────────────────────┐
                      │   Amazon SES (relay)   │ ──▶ subscriber inbox
                      └───────────────────────┘
```

### Domains

| Role | Value | Notes |
|---|---|---|
| Landing page (unchanged) | `plvs.soundoer.com` | Subscribe form added here |
| VPS service | `list.plvs.soundoer.com` | New subdomain, A record → VPS IP; Caddy TLS |
| From address | `<local-part>@soundoer.com` | Root domain verified in SES with DKIM; exact local-part (e.g. `newsletter@`, `hello@`) decided at setup |

These are independent DNS records and do not affect the existing
`plvs.soundoer.com` landing hosting.

### Core design decisions

1. **Double opt-in (mandatory).** A new subscriber first receives a
   "confirm your subscription" email; only after clicking does status become
   `confirmed`. Protects deliverability (blocks forged/typo addresses that hurt
   sender reputation) and is the compliant default.
2. **One-click unsubscribe (mandatory).** Every newsletter carries a
   per-subscriber unsubscribe link and a `List-Unsubscribe` header (plus RFC
   8058 `List-Unsubscribe-Post`). Required by Gmail/Yahoo bulk-sender rules;
   omitting it causes downranking to spam.
3. **Subdomain separation.** Static site on the main domain; VPS service on a
   subdomain. Independent, non-interfering.
4. **Data stays on the VPS.** SQLite file on the VPS; SES is only a pipe and
   never holds the list.

## Technology Stack

**Service language: Node.js.** The logic is thin (three HTTP endpoints + a send
script); Node's ecosystem covers SMTP sending, SQLite, and HTML email templating
with minimal code. Rust (matching the PLVS backend) was considered and rejected
as unnecessarily verbose for a service this small.

- **HTTP + endpoints:** minimal Node service (Fastify or native `http`).
- **Storage:** SQLite single file (`better-sqlite3`). Backup = copy the file.
- **Sending:** `nodemailer` over SES's standard SMTP interface.
- **TLS / reverse proxy:** Caddy (auto Let's Encrypt cert + renewal for
  `list.plvs.soundoer.com`).
- **Process supervision:** systemd unit (auto-start, auto-restart).

## Data Model

A single SQLite table, `subscribers`:

| Column | Notes |
|---|---|
| `email` | Unique; the subscriber address |
| `status` | `pending` / `confirmed` / `unsubscribed` |
| `token` | Long random string; used for both confirm and unsubscribe links |
| `created_at` | Subscription request time |
| `confirmed_at` | Set on confirm |
| `unsubscribed_at` | Set on unsubscribe |

No additional tables initially (YAGNI). A send log can be added later if needed.

## Endpoints

### `POST /subscribe`

Called by the landing-page form.

- Validate email format.
- **Honeypot** hidden field: if filled (bots), silently drop as spam.
- **Per-IP rate limit** to prevent abuse.
- New email → store as `pending`, generate `token`, send confirmation email via
  SES.
- Already `confirmed` → return a uniform success message; **do not reveal**
  whether the address is on the list.
- Previously `pending` (unconfirmed) → resend confirmation (rate-limited, to
  prevent using this as a mail-bombing vector against arbitrary addresses).

### `GET /confirm?token=xxx`

- Look up by token, set `status = confirmed`, record `confirmed_at`.
- Return a simple "subscription confirmed" HTML page.

### `GET /unsubscribe?token=xxx`

- Look up by token, set `status = unsubscribed`, record `unsubscribed_at`.
- Return a simple "unsubscribed" HTML page.
- Also support the one-click **POST** form (RFC 8058 `List-Unsubscribe-Post`)
  so Gmail shows a native unsubscribe button.

Defaults: broadcasts go only to `status = confirmed`; confirm/unsubscribe pages
are minimal HTML (styling to match the landing page is a later, optional polish).

## Sending CLI

Invoked as `node send-newsletter.mjs <draft.md>`.

Draft format: a Markdown file whose first line is `Subject: ...`, followed by the
body. Markdown is rendered to HTML and wrapped in a minimal email template.

Behavior:

- Pull all `confirmed` subscribers from SQLite.
- Send one email per subscriber, each with that subscriber's unique unsubscribe
  link and `List-Unsubscribe` headers.
- Throttle to SES's send rate; print progress (`sent 42 / 156 ...`); collect and
  report failed addresses at the end.
- **Safety switches:**
  - `--dry-run`: render and print, send nothing.
  - `--test <email>`: send a single copy to the given address for preview.
  - Before a real broadcast, print a confirmation prompt
    (`about to send to 156 people, type yes to continue`).
- Sequential send is interruptible (Ctrl+C stops mid-run; nothing is sent in one
  irrecoverable burst).
- No resume/dedup/idempotency initially (YAGNI at hundreds of recipients; add if
  volume grows).

### Operator workflow (day-in-the-life)

1. Write a Markdown draft (`Subject:` line + body).
2. Preview: `node send-newsletter.mjs draft.md --test me@example.com`, check the
   rendered email and links in your own inbox.
3. Broadcast: `node send-newsletter.mjs draft.md`, confirm the prompt, watch
   progress.

Subscription, double opt-in, and unsubscribe are handled automatically by the
running service; the operator only writes a file and runs a command. Operating
over SSH is the accepted cost of the "script first, no web admin" choice; a web
admin UI can be added later if the CLI becomes tedious.

## Deliverability & DNS

One-time setup on `soundoer.com`. This determines inbox vs. spam placement.

- **DKIM:** SES provides 3 CNAME records; add them to `soundoer.com` DNS; SES
  auto-verifies. This is the core.
- **SPF / custom MAIL FROM:** configure a custom MAIL FROM subdomain (e.g.
  `mail.soundoer.com`) in SES; add the corresponding MX + TXT records so both
  SPF and DKIM align to `soundoer.com` and DMARC passes.
- **DMARC:** add a `_dmarc.soundoer.com` TXT record, starting at `p=none`
  (monitor only), tightening later once stable.
- **SES production access:** new accounts are sandboxed (can only send to
  verified addresses). Submit the "request production access" form describing the
  use case (own product's newsletter); typically approved in 1–2 days.
- **Service subdomain:** add an A record for `list.plvs.soundoer.com` → VPS IP;
  Caddy handles HTTPS automatically.

## Anti-Spam & Compliance

- Subscribe side: honeypot field + per-IP rate limit (above).
- Every email footer: unsubscribe link + a line identifying the sender.
- **CAN-SPAM** strictly requires a physical postal address in the footer. For a
  personal project, include a reachable contact/address at the maintainer's
  discretion. **Recommended**, flagged here rather than mandated.

## Out of Scope (initial version)

- Web admin UI (script-first; revisit if CLI is tedious).
- Send logs, open/click tracking, analytics.
- Resume/dedup on interrupted sends.
- Styled confirm/unsubscribe pages matching landing design (later polish).
- Segments, tags, or multiple lists.

## Success Criteria

- A visitor can submit their email on `plvs.soundoer.com`, receive a confirmation
  email, click it, and become `confirmed`.
- A confirmed subscriber receives a broadcast sent via the CLI, and it lands in
  the inbox (not spam), with a working one-click unsubscribe.
- An unsubscribe removes the address from future broadcasts.
- SES DKIM/SPF/DMARC all pass (verifiable via the received email's headers).
- The maintainer can send a newsletter by writing a Markdown file and running one
  command.
