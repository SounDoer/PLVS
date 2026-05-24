# Landing Page Layout & Content Polish

**Issue:** #139  
**Date:** 2026-05-24  
**Scope:** `landing/index.html` only — no screenshots or images this iteration

---

## Changes

### 1. Installation Warnings — Inline Under Download Buttons

**Current state:** Installation instructions (macOS Gatekeeper, Windows SmartScreen) live in a dedicated section near the bottom of the page. Most users won't scroll that far before getting blocked.

**Change:** Remove the Installation section. Add a one-line inline note directly beneath each platform's button group in the hero.

- **macOS button group** (below the `btn-group` div):  
  `First launch: if macOS blocks the app, run xattr -cr /Applications/PLVS.app`

- **Windows button group** (below the `btn-group` div):  
  `If SmartScreen blocks the installer — More info → Run anyway`

Styling: same `.portable-link` / small muted text treatment as the existing "Portable version" link — `font-size: 12px`, `color: var(--muted-foreground)`, no border underline needed (plain text, not a link).

### 2. Feature Section — Reorder + Merge Appearance

**Current order:**
1. System Audio
2. Fully flexible layout *(Workspace)*
3. Session history & snapshots *(History)*
4. Multichannel support *(Multichannel)*

**New order:**
1. System Audio — unchanged
2. Session history & snapshots — moved from 3rd to 2nd
3. Multichannel support — moved from 4th to 3rd
4. **Appearance** — Fully flexible layout merged with custom theme, moved from 2nd to last

The alternating `reverse` class follows position, not content — rows 1 & 3 are normal, rows 2 & 4 are reversed.

**New Appearance feature copy:**

| Field | Value |
|-------|-------|
| kicker | `Appearance` |
| title | `Fully flexible layout` |
| desc | Drag any divider to resize panels and rearrange your workspace with split-tree layout. Pop out individual meters to float on a second screen. Switch between dark and light themes to match your environment. |

---

## Out of Scope

- App screenshots and feature images (all placeholders remain)
- Any other sections (hero copy, system requirements, footer)
