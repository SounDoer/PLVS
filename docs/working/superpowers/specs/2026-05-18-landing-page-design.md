# PLVS Landing Page Design

**Date:** 2026-05-18
**URL:** `plvs.soundoer.com`
**Tech stack:** Static HTML + CSS + minimal JS (no framework, no backend)
**Deployment:** GitHub Pages, CNAME to `plvs.soundoer.com`

---

## Page Structure

From top to bottom:

1. **Hero**
2. **Screenshot** (placeholder until real screenshot is ready)
3. **Features** × 4
4. **System Requirements**
5. **Installation**
6. **Footer**

---

## Section Specs

### 1. Hero

```
PLVS  reads as "plus"
Free, open-source real-time audio metering for Windows & macOS
Peak · Loudness · Vectorscope · Spectrum · Spectrogram

[Windows Installer]  [macOS Apple Silicon]  v0.1.0
  Portable version ↗
```

- **Logo:** JetBrains Mono, 48px, weight 800, letter-spacing 0.18em
- **"reads as 'plus'":** inline after logo, italic, muted, 12px
- **Tagline:** "Free, open-source real-time audio metering for Windows & macOS" — #9e9488, 16px
- **Module line:** Peak · Loudness · Vectorscope · Spectrum · Spectrogram — JetBrains Mono, 13px, #fb923c, separator dots at 35% opacity
- **Download buttons:** Platform-aware via JS (`navigator.platform` / `navigator.userAgent`)
  - Detected platform gets the primary (orange `#fb923c`) button and moves to the left
  - Other platform gets the secondary (outline) button
  - Default (non-Windows/macOS, e.g. Linux, mobile): Windows primary
  - Windows group: primary "Windows Installer" button + "Portable version" text link below
  - macOS group: single "macOS Apple Silicon" button
- **Version chip:** `v0.1.0` — JetBrains Mono, 11px, `rgba(251,146,60,0.55)`, aligned center-right of button row
- No meta line below buttons

### 2. Screenshot

- Full-width placeholder (`#1e1b17` background, 380px height, rounded 10px)
- Replace with real app screenshot when available — no layout change required

### 3. Features

Four rows, alternating image-left / image-right layout (1:1 grid, 48px gap):

| # | Kicker | Title | Side |
|---|--------|-------|------|
| 1 | System Audio | Native system audio capture | Image left |
| 2 | Workspace | Fully flexible layout | Image right |
| 3 | History | Session history & snapshots | Image left |
| 4 | Multichannel | Multichannel support | Image right |

**Copy:**

**Native system audio capture** — Monitor any audio playing on your machine — no virtual audio cable required. Windows uses WASAPI loopback, macOS uses the native audio tap.

**Fully flexible layout** — Drag any divider to resize panels. Rearrange your workspace with split-tree layout.

**Session history & snapshots** — Scroll back through the loudness history timeline. Click any moment to freeze all meters at that snapshot — then return to live with one click.

**Multichannel support** — Works with stereo and surround formats. Automatic channel layout detection with proper per-channel metering and ITU-R BS.1770 loudness for multichannel sources.

Each feature image area is a placeholder (`aspect-ratio: 16/10`) to be replaced with real screenshots or screen recordings.

### 4. System Requirements

Two-column card grid:

| | Windows | macOS |
|--|---------|-------|
| OS / Architecture | Windows 10 / 11 | Apple Silicon |
| Installer | NSIS .exe | DMG (-aarch64) |
| System audio | WASAPI loopback | macOS 14.2+ *(verify)* |

> **Note:** macOS system audio minimum version (14.2+) needs verification against `architecture.md`.

### 5. Installation

Two-column card grid:

**macOS — Gatekeeper:** PLVS is not notarized by Apple. If macOS blocks the app on first launch, run:
```
xattr -cr /Applications/PLVS.app
```

**Windows — SmartScreen:** If Windows SmartScreen blocks the installer, click **More info** → **Run anyway**.

### 6. Footer

Right-aligned: `GitHub` (link to https://github.com/SounDoer/PLVS) · `MIT License` · `v0.1.0`

---

## Visual Language

Aligned with PLVS design tokens (`docs/design-tokens.md`):

| Role | Value |
|------|-------|
| Page background | `#0d0c0b` |
| Panel surface | `#1e1b17` |
| Primary text | `#f5f0ea` |
| Muted text | `#9e9488` |
| Brand / accent | `#fb923c` |
| Border | `rgba(255,255,255,0.07)` |
| Font — body | Inter |
| Font — mono / data | JetBrains Mono |

Section labels: JetBrains Mono, 11px, uppercase, letter-spacing 0.12em, `#fb923c`

---

## Download Links

Point directly to GitHub Releases assets. Update version string (`v0.1.0`) and URLs at each release. Download URLs follow the pattern:

```
https://github.com/SounDoer/PLVS/releases/download/v0.1.0/PLVS_0.1.0_x64-setup.exe
https://github.com/SounDoer/PLVS/releases/download/v0.1.0/PLVS_0.1.0_x64_portable.exe
https://github.com/SounDoer/PLVS/releases/download/v0.1.0/PLVS_0.1.0_aarch64.dmg
```

*(Confirm exact filenames from CI release workflow.)*

---

## Out of Scope

- Top navigation bar
- i18n / localization
- Analytics or telemetry
- Changelog page
- Blog / announcement section
