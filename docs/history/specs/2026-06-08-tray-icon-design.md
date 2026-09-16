# Tray Icon Design

**Date:** 2026-06-08
**Status:** Approved

## Overview

Design and implement a custom system tray icon for PLVS. Currently `useTray.js` creates the `TrayIcon` without specifying an `icon`, so Tauri falls back to the default app icon. This spec defines a purpose-built tray icon.

## Design

**Shape:** Letter P — thin stroke, wide rounded bowl ending at ~60% of the stem height.

**SVG definition (20×20 viewBox):**
```svg
<line x1="5" y1="2" x2="5" y2="18" stroke="black" stroke-width="1.5" stroke-linecap="round"/>
<path d="M5 2 Q15.5 2 15.5 7 Q15.5 12 5 12" stroke="black" stroke-width="1.5" fill="none" stroke-linecap="round"/>
```

**Color:** Black on transparent background.
- macOS: loaded as a template image — the system automatically inverts to white in dark menu bars and handles the highlighted (blue) state.
- Windows: rendered white-on-dark by the OS in dark mode (the dominant use case). Theme-adaptive swapping (detecting light mode and switching to a black icon) is deferred as a future improvement.

## File

| Path | Size | Format |
|------|------|--------|
| `src-tauri/icons/tray.png` | 44×44 px | PNG, black stroke on transparent |

Generate from the SVG definition using a small Node.js script (`scripts/generate-tray-icon.mjs`) with `sharp`. The script renders the SVG string to a 44×44 PNG and writes it to `src-tauri/icons/tray.png`.

## Integration

In `useTray.js`, load the icon at tray creation time:

```js
import { Image } from "@tauri-apps/api/image";
import { resolveResource } from "@tauri-apps/api/path";

const iconPath = await resolveResource("icons/tray.png");
const icon = await Image.fromPath(iconPath);

const tray = await TrayIcon.new({
  icon,
  iconAsTemplate: true,   // macOS only — no-op on Windows
  tooltip: "PLVS",
  ...
});
```

`resolveResource` resolves against the Tauri resource directory so the PNG is found in both dev and production builds. The file must be listed under `bundle.resources` in `tauri.conf.json` (or already covered by a glob).

## Out of Scope

- Theme-adaptive icon swap on Windows (light vs dark mode detection)
- Animated icon to indicate capture state
