# Landing Page `/docs` Subpage — Design Spec

**Date:** 2026-07-01
**Scope:** Add a `docs` subpage under the existing static landing site (`landing/`), covering product features and operation guides.

---

## Problem

`plvs.soundoer.com` (served from `landing/`) currently has only a marketing homepage. There is no user-facing documentation on the web — new users have no single place to learn how to use PLVS beyond the GitHub README and in-app UI. We want a `docs` page that explains what each meter panel shows and how to perform common operations (device selection, theme switching, workspace layout, config export, etc.).

Technical/dependency information (frameworks, license, contribution) stays in the GitHub README — it is explicitly out of scope for this page.

---

## Approach

`landing/` is a hand-written static site (single `index.html`, inline CSS, no build tooling, deployed via GitHub Pages / `deploy-landing.yml` on any push touching `landing/**`). Introducing a docs framework (VitePress/Docusaurus) would split the site into two different maintenance models for no real benefit at this content scale. Instead:

- New file: `landing/docs/index.html` (served at `/docs/` via GitHub Pages), reusing the CSS variables and typography already defined in `landing/index.html` (`--page`, `--ink`, `--accent`, `--font-sans`, etc.) so it reads as an extension of the landing page, not a separate product.
- Single long page with anchor-based navigation: a fixed left sidebar on desktop (list of section links), collapsing to a top dropdown/anchor list on narrow viewports (matches the landing page's existing responsive pattern).
- Content is written directly against the current feature set as observed in the codebase (`docs/prd.md` §5, §A.1) — not aspirational/roadmap features. Anything listed in PRD §6 "非目标" (e.g., audio data export/CSV, Linux, plugin form factor) is explicitly called out as *not supported* in the FAQ section rather than omitted, to prevent user confusion.
- The existing landing page top nav gets one added link: "Docs" → `/docs/`.

No changes to the deploy workflow are needed — `deploy-landing.yml` already uploads the entire `landing/` directory as the Pages artifact.

---

## Content Outline (final order)

1. **Getting Started**
   - Download/install (Windows, macOS)
   - Unsigned-build friction: SmartScreen (Windows) / Gatekeeper (macOS) first-run steps
   - First launch: pick a signal source, explicit Start (app never auto-starts capture)

2. **Signal Source**
   - Unified source dropdown: Automatic / system playback (loopback) / physical input
   - Windows (WASAPI loopback + input) vs macOS (system-audio tap on supported OS versions + cpal input) path differences, and what happens on unsupported macOS versions

3. **Panels** (what each meter shows + how to read it)
   - Level Meter (peak/loudness-switchable, per-channel)
   - Loudness (LUFS, BS.1770/R128 framing, integrated/short-term/momentary)
   - Stats
   - Spectrum (fixed-reference RTA view, not IEC 61260 filter-bank)
   - Spectrogram
   - Vectorscope/correlation (always a channel pair, default Front L/R, pair selectable)
   - Waveform

4. **Dialogue-gated Loudness**
   - What it's for (dialogue-gated loudness measurement)
   - VAD engine selection (Silero default, FireRedVAD, TEN VAD)
   - Output metrics: Coverage / Range / Offset / Active

5. **Multichannel**
   - Auto-detected layouts: mono / stereo / 5.1 / 7.1
   - Manual layout override (Stereo / 5.1 / 7.1 presets)
   - Per-panel behavior: Level Meter per-channel, Loudness L1 path per layout, Spectrum/Vectorscope channel-pair selection

6. **Workspace**
   - Split layout (panel arrangement), persistence across restarts

7. **File Mode**
   - Local file offline analysis: opening a file, ffprobe metadata, decode, scrub/seek, session-local history
   - Still read-only, no processing

8. **System Settings**
   - Tray & Autostart: close-to-tray vs quit, launch-at-login
   - Shortcuts: built-in shortcuts, recording a custom global Clear shortcut
   - Themes: built-in Light/Dark, follow-system default, custom theme editor
   - Configuration Export/Import: exporting/importing/resetting app configuration (this is settings/workspace config, not audio measurement data)

9. **FAQ / Known Limitations**
   - No audio processing (EQ/routing) — read-only by design
   - No plugin form factor (VST/AU/AAX)
   - No Linux build
   - No audio data export (CSV/screenshots) yet — explicitly not implemented
   - No code signing/notarization yet — why SmartScreen/Gatekeeper warnings appear
   - No default telemetry; audio stays on-device

---

## Navigation

- Desktop: fixed left sidebar listing all 9 section anchors, current section highlighted on scroll (simple `IntersectionObserver`, no framework).
- Mobile/narrow: sidebar collapses to a horizontal scrollable pill list or a dropdown, consistent with how `landing/index.html` already adapts its nav at narrow widths.
- **Entry point (landing → docs):** landing page top nav gets one new entry: `Docs` → `landing/docs/index.html`.
- **Return path (docs → landing):** `landing/docs/index.html` reuses the same top nav bar component/markup as the landing page; the logo/wordmark on the left of that nav links back to `../index.html`. No separate "Back" button — clicking the logo is the return path, consistent with standard docs-site conventions.

---

## Non-Goals

- No tech-stack/dependency/license writeup (stays in GitHub README).
- No docs framework/build tooling (VitePress, Docusaurus, MDX).
- No multi-page split — everything lives in one HTML file with anchors.
- No i18n — English only, matching current landing page and in-app UI language.

---

## Testing

- `landing/index.test.js` currently tests `landing/index.html`; extend or add `landing/docs/index.test.js` following the same pattern (structural/content assertions, no visual regression tooling introduced).
- Manual check: open `landing/docs/index.html` locally, verify anchor nav scrolls correctly, verify responsive collapse at mobile width.
