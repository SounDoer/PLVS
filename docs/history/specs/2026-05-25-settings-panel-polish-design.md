# Settings Panel Polish — Design Spec

**Issue:** #143  
**Date:** 2026-05-25  
**Status:** Approved

---

## Overview

Five polish items for the Settings panel:

1. Replace "Loudness reference" preset dropdown with a custom LUFS number input (default -23)
2. Reorder settings rows: appearance first, parameters after
3. Remove legacy "Reset Layout" button
4. Speed up the panel exit animation
5. Remove the Popover nesting from the audio device toolbar icon

---

## Data Layer: `referenceLufs` Migration

### Why

The three preset profiles (EBU R128, YouTube, Spotify) all use the same ITU-R BS.1770 measurement algorithm. The only difference between them is the target LUFS value. Storing a profile ID is unnecessary indirection — a plain number is sufficient and more flexible.

### `loudnessReferenceProfiles.js`

Strip to a single export:

```js
export const DEFAULT_REFERENCE_LUFS = -23;
```

Delete: `LOUDNESS_REFERENCE_PROFILES`, `LOUDNESS_REFERENCE_PROFILE_IDS`, `normalizeLoudnessReferenceProfileId`, `getLoudnessReferenceProfileById`.  
Delete: `loudnessReferenceProfiles.test.js` (tests cover deleted functions).

### `useSettings.js`

Replace `referenceProfileId: string` with `referenceLufs: number`.

- Read from localStorage: `s.referenceLufs`
- Normalize: finite number in `[-70, 0]`, otherwise default to `-23`
- Return: `referenceLufs`, `setReferenceLufs`

### `App.jsx` — Persistence

In the `localStorage.setItem` effect, replace `referenceProfileId` with `referenceLufs` (same `STORE_KEY`).

Migration: existing saves have no `referenceLufs` key → `undefined` → normalizes to `-23`. Users who had YouTube/Spotify (-14) get reset to -23; acceptable for a polish change.

### `useLoudnessHistory.js`

- Parameter: `referenceProfileId` → `referenceLufs: number`
- Remove `getLoudnessReferenceProfileById` import
- `targetLufs = referenceLufs` directly
- Return `referenceLufs` instead of `referenceProfile` object

### `LoudnessPanel.jsx` → `LoudnessHistoryChart.jsx`

Prop chain: `referenceProfile` object → `referenceLufs: number`.

In `LoudnessHistoryChart`:
- Remove the two-line derived-`referenceLufs` logic
- Chart legend: `Ref ${referenceLufs} LUFS`

---

## SettingsPanel UI

### Props

**Removed:** `referenceProfileId`, `setReferenceProfileId`, `loudnessReferenceProfiles`, `resetLayout`  
**Added:** `referenceLufs: number`, `setReferenceLufs: (n: number) => void`

### New Section Order

```
Appearance              ← Select: Follow system / Fixed theme
Colour theme            ← Select: conditional on appearance === "fixed"
────────────────────────
Loudness reference      ← <input type="number"> + "LUFS" suffix, min=-70 max=0 step=1
Channel layout          ← Select (Advanced)
Vectorscope channels    ← Select
```

Reset Layout row and its separator are deleted entirely.

### Exit Animation

Add an inline `transition` to the `exit` target — Framer Motion applies it only on exit, leaving the spring enter animation unchanged:

```js
exit={
  reduceMotion
    ? { opacity: 1 }
    : { opacity: 0, x: 14, transition: { duration: 0.12, ease: "easeIn" } }
}
```

---

## Audio Device Toolbar (App.jsx)

Replace the `Popover + CaptureDeviceSelect` block with a bare `Select`:

```jsx
<Select value={captureDeviceId} onValueChange={...} disabled={!audioDevices.length}>
  <SelectTrigger
    className="flex items-center justify-center size-8 rounded-md
               text-muted-foreground bg-transparent border-0 shadow-none
               hover:bg-secondary hover:text-foreground
               transition-colors duration-[120ms]
               [&>svg:last-child]:hidden"
  >
    <Volume2 className="size-3.5" />
  </SelectTrigger>
  <SelectContent align="end" sideOffset={6} className="max-w-[min(22rem,90vw)]">
    <SelectItem value="default">Automatic (default system output)</SelectItem>
    {outputs.length ? (
      <SelectGroup>
        <SelectLabel>Output</SelectLabel>
        {outputs.map((d) => <SelectItem key={d.id} value={d.id}>...</SelectItem>)}
      </SelectGroup>
    ) : null}
    {inputs.length ? (
      <SelectGroup>
        <SelectLabel>Input</SelectLabel>
        {inputs.map((d) => <SelectItem key={d.id} value={d.id}>...</SelectItem>)}
      </SelectGroup>
    ) : null}
  </SelectContent>
</Select>
```

Chevron hidden via `[&>svg:last-child]:hidden`. Tooltip via `div.group` wrapper (same CSS hover pattern as `IconButton`).

The grouping logic (`outputs`/`inputs` derived from `audioDevices`) is inlined from `CaptureDeviceSelect`. `CaptureDeviceSelect.jsx` is deleted.

---

## Footer

```jsx
// before
{referenceProfile.label}

// after
{referenceLufs} LUFS
```

---

## Files Changed

| File | Action |
|---|---|
| `src/config/loudnessReferenceProfiles.js` | Strip to single constant |
| `src/config/loudnessReferenceProfiles.test.js` | Delete |
| `src/hooks/useSettings.js` | `referenceProfileId` → `referenceLufs` |
| `src/hooks/useLoudnessHistory.js` | `referenceProfileId` → `referenceLufs` |
| `src/components/SettingsPanel.jsx` | UI changes (all 5 items) |
| `src/components/SettingsPanel.test.jsx` | Update props |
| `src/components/panels/LoudnessPanel.jsx` | prop chain update |
| `src/components/panels/LoudnessHistoryChart.jsx` | `referenceProfile` → `referenceLufs` |
| `src/App.jsx` | Persistence, audio device select, footer, prop wiring |
| `src/components/CaptureDeviceSelect.jsx` | Delete |
