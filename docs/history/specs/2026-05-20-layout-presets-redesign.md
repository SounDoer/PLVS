# Layout Presets Redesign

**Date:** 2026-05-20  
**Status:** Approved

## Summary

Replace the 4 existing built-in presets with 3 new ones. All panels are shown as independent leaves (no tab grouping). Preset names use abbreviated module-based identifiers.

The existing presets (`default`, `broadcast`, `compact`, `spectrum-focus`) are removed. The new default preset keeps the `"default"` ID so existing stored workspace state degrades gracefully.

---

## New Presets

### 1. PLVS Full (`id: "default"`)

All 6 modules. Three columns.

| Column | Panels (top → bottom) |
|--------|----------------------|
| Left   | Peak                 |
| Middle | Loudness → Spectrogram → Spectrum |
| Right  | Loudness Stats → Vectorscope |

**Tree:**
```js
{
  type: "split",
  direction: "h",
  sizes: [220, 0, 260],
  children: [
    { type: "leaf", tabs: ["peak"], activeTab: "peak" },
    {
      type: "split",
      direction: "v",
      sizes: [0, 0, 0],
      children: [
        { type: "leaf", tabs: ["loudness"], activeTab: "loudness" },
        { type: "leaf", tabs: ["spectrogram"], activeTab: "spectrogram" },
        { type: "leaf", tabs: ["spectrum"], activeTab: "spectrum" },
      ],
    },
    {
      type: "split",
      direction: "v",
      sizes: [0, 0],
      children: [
        { type: "leaf", tabs: ["loudnessStats"], activeTab: "loudnessStats" },
        { type: "leaf", tabs: ["vectorscope"], activeTab: "vectorscope" },
      ],
    },
  ],
}
```

`visibleModules`: all 6 — `["peak", "loudness", "loudnessStats", "vectorscope", "spectrum", "spectrogram"]`

---

### 2. LLS (`id: "lls"`)

3 modules: Loudness, Loudness Stats, Spectrum. Two columns.

| Column | Panels (top → bottom) |
|--------|----------------------|
| Left   | Loudness → Spectrum  |
| Right  | Loudness Stats       |

**Tree:**
```js
{
  type: "split",
  direction: "h",
  sizes: [0, 260],
  children: [
    {
      type: "split",
      direction: "v",
      sizes: [0, 0],
      children: [
        { type: "leaf", tabs: ["loudness"], activeTab: "loudness" },
        { type: "leaf", tabs: ["spectrum"], activeTab: "spectrum" },
      ],
    },
    { type: "leaf", tabs: ["loudnessStats"], activeTab: "loudnessStats" },
  ],
}
```

`visibleModules`: `["loudness", "loudnessStats", "spectrum"]`

---

### 3. PLLV (`id: "pllv"`)

4 modules: Peak, Loudness, Loudness Stats, Vectorscope. Three columns.

| Column | Panels (top → bottom)  |
|--------|------------------------|
| Left   | Peak → Vectorscope     |
| Middle | Loudness               |
| Right  | Loudness Stats         |

**Tree:**
```js
{
  type: "split",
  direction: "h",
  sizes: [200, 0, 260],
  children: [
    {
      type: "split",
      direction: "v",
      sizes: [0, 0],
      children: [
        { type: "leaf", tabs: ["peak"], activeTab: "peak" },
        { type: "leaf", tabs: ["vectorscope"], activeTab: "vectorscope" },
      ],
    },
    { type: "leaf", tabs: ["loudness"], activeTab: "loudness" },
    { type: "leaf", tabs: ["loudnessStats"], activeTab: "loudnessStats" },
  ],
}
```

`visibleModules`: `["peak", "loudness", "loudnessStats", "vectorscope"]`

---

## Changes Required

### `src/workspace/constants.js`

- Replace `DEFAULT_TREE` with the PLVS Full tree above.
- Replace `BUILTIN_PRESETS` array with the 3 new presets.
- `DEFAULT_WORKSPACE_STATE.visibleModules` stays as all 6 modules.
- `DEFAULT_WORKSPACE_STATE.activePresetId` stays `"default"`.

No other files need changes — preset application logic in `reducer.js` is unchanged.
