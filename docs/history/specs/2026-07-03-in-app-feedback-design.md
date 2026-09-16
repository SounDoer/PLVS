# In-App User Feedback

**Date:** 2026-07-03
**Status:** Draft

## Summary

Add a "Send Feedback" entry to the PLVS Settings panel. A user can write free-text
feedback and optionally leave an email address; submitting POSTs to a new
`/feedback` endpoint on the existing `soundoer-newsletter` service, which emails
the content to the maintainer (`xichen@soundoer.com`) via the already-configured
Amazon SES relay. If the user left an email, the outgoing mail's `Reply-To` is
set to it, so replying from the maintainer's inbox reaches the user directly —
the same pattern just built for newsletter replies (see
[2026-07-02-email-newsletter-self-hosted-design.md](2026-07-02-email-newsletter-self-hosted-design.md)).

## Motivation

PLVS currently has no in-app way for users to report bugs or send suggestions.
The maintainer wants a low-friction entry point inside the app itself, reusing
the SES + `soundoer-newsletter` infrastructure that already exists rather than
standing up anything new.

## Architecture

```
PLVS desktop app (Tauri + React)
  SettingsPanel.jsx
    └─ new "Feedback" section → "Send Feedback" button
         └─ FeedbackDialog.jsx (draggable floating panel, no overlay)
              └─ src/lib/feedback.js: fetch POST
                                             │
                                             │ HTTPS (connect-src allow-listed
                                             │ in tauri.conf.json CSP)
                                             ▼
                          https://list.plvs.soundoer.com/feedback
                          (soundoer-newsletter repo, new Fastify route)
                            - reuses existing rate-limit plugin
                            - reuses src/email.js transport/sendMail
                                             │
                                             ▼
                          Amazon SES SMTP relay
                            From: newsletter@soundoer.com
                            Reply-To: <user email, if provided>
                                             ▼
                              xichen@soundoer.com (maintainer inbox)
```

This is a **separate concern from audio-engine IPC**. The Rust audio engine
communication convention (`src/ipc/`) does not apply here — this is a plain
HTTPS `fetch` to an external service, following the existing precedent in
`src/lib/updateCheck.js` (which already does an unauthenticated `fetch` to the
GitHub API from a lib module, not through `src/ipc/`).

## Frontend

**`src/components/FeedbackDialog.jsx`** (new) — modeled on
`src/components/ThemeEditor.jsx`: a draggable `@radix-ui/react-dialog` panel
with no overlay, so the user can drag it aside and keep looking at the meter
panel they're reporting an issue about.

Fields:
- **Content** — multi-line textarea, required. Submit is disabled while empty.
- **Email** — single-line input, optional. Validated on blur with a simple
  regex (`/^[^\s@]+@[^\s@]+\.[^\s@]+$/`); an invalid value shows inline red
  text (same visual pattern as `ColorControl.jsx`) but does not block typing.

Behavior:
- Submit button shows a loading state while the request is in flight.
- On success: show a short status message (reusing the existing
  `configurationStatus` text pattern from `SettingsPanel.jsx`, not a new toast
  component) and auto-close the dialog after ~2s.
- On failure (network error, non-2xx, timeout): show "Failed to send, please
  try again", keep the user's input, allow retry. No offline/online
  distinction — both surface as the same failure state.

**`src/components/SettingsPanel.jsx`** — add a new "Feedback" section (its own
`SettingsSection`, placed after the existing sections and before the Footer)
containing a single row with a "Send Feedback" button that opens
`FeedbackDialog`, following the same open/close wiring `ThemeEditor` uses
today.

**`src/lib/feedback.js`** (new) — the fetch call itself, `try/catch` style like
`updateCheck.js`. Not routed through `src/ipc/` (see Architecture note above).

**`src-tauri/tauri.conf.json`** — add `https://list.plvs.soundoer.com` to the
CSP `connect-src` list (currently `ipc: http://ipc.localhost
https://api.github.com`).

## Backend (`soundoer-newsletter` repo)

New route: `POST /feedback`, JSON body `{ content: string, email?: string }`.

- **Rate limiting**: reuse the existing `@fastify/rate-limit` registration,
  same order of magnitude as `/subscribe` (e.g. 5/minute per IP).
- **Validation**: `content` required, non-empty, capped at 5000 characters
  (400 if missing/empty/too long). `email`, if present, must pass a basic
  format check (400 if invalid).
- **Email composition**: reuses `src/email.js`'s existing transport/`sendMail`
  helper. Plain-text body containing the feedback content and the submitted
  email (if any, so it's visible in the message body too, not just the
  header). `From: ${config.fromName} <${config.fromEmail}>` (same sender
  identity newsletters use). `replyTo` set to the submitted email when
  present, otherwise omitted — mirrors the `REPLY_TO` wiring just added for
  `bin/send-newsletter.mjs`, except here it's per-request (the submitter's own
  address) rather than the static maintainer `REPLY_TO`.
- Sends directly to the maintainer address (`xichen@soundoer.com`), configured
  via a new `FEEDBACK_TO` env var (falls back to `REPLY_TO` if unset, since in
  practice they're the same mailbox today).

## Error Handling

| Failure | Frontend behavior | Backend behavior |
|---|---|---|
| Empty content | Submit button disabled | (unreachable — client blocks) |
| Invalid email format | Inline red text, submit button disabled until fixed or cleared | 400 if an invalid email slips through |
| Network failure / timeout | "Failed to send, please try again", input preserved | n/a |
| Rate limit hit | Same generic failure message (429 treated like any other non-2xx) | 429 |
| SES send failure | Same generic failure message | 500, logged server-side |

## Testing

- **Frontend** (`FeedbackDialog.test.jsx`, new): empty content keeps submit
  disabled; invalid email blocks submit; successful submit shows success state
  and calls the close callback; failed submit shows error state and preserves
  input.
- **Backend** (`test/server.test.js`, extended): valid submission sends mail
  with correct `Reply-To`; missing/empty `content` → 400; oversized `content`
  → 400; malformed `email` → 400; repeated requests past the rate limit → 429.

## Deployment

- Push `soundoer-newsletter` changes, then on the VPS:
  `sudo -u ubuntu git -C /home/ubuntu/soundoer-newsletter pull &&
  sudo systemctl restart soundoer-newsletter` (same flow as the `REPLY_TO`
  change).
- Add `FEEDBACK_TO=xichen@soundoer.com` to the VPS `.env` (and
  `.env.example`).
- The CSP change in `tauri.conf.json` ships with the next PLVS release; no
  separate deploy step.

## Out of Scope

- No admin UI for browsing past feedback (mail is the inbox).
- No captcha/human-verification — rate limiting is judged sufficient at
  current scale (see [2026-07-02-email-newsletter-self-hosted-design.md](2026-07-02-email-newsletter-self-hosted-design.md)
  for the same call on `/subscribe`).
- No attachment/screenshot support in v1.
- No persistence of feedback submissions beyond the email itself (unlike
  newsletter subscribers, feedback isn't stored in SQLite).
