# Spectrum Y-axis Range Implementation Plan

Status: Implemented

**Goal:** Give Spectrum a better default Y-axis display range and expose precise endpoint controls
for non-time panel axes.

**Spec:** `docs/superpowers/specs/2026-06-25-spectrum-y-axis-range-design.md`

**Implemented behavior**

- Spectrum defaults to `-96..-12 dB`.
- Spectrum settings show `Peak hold`, `Smoothing`, `Tilt`, then compact `X range` and `Y range`
  endpoint rows.
- Spectrogram, Loudness, and Level Meter settings also expose one `Y range` endpoint row.
- Spectrogram settings render even when the range row is the only available control.
- Loudness keeps `Layers` first and places `Y range` after it.
- Range endpoint fields render rounded integer values and use a compact width that still leaves
  room for negative signs and digits.
- Time-axis range remains gesture-only and is not added to panel settings.
- Spectrum Y-axis display controls remain frontend-only and are excluded from Spectrum analysis
  request keys.
- Legacy `spectrumYRangeDb` input is accepted and normalized into `spectrumYMinDb` /
  `spectrumYMaxDb`.
- Spectrogram color mapping keeps its independent `0..-84 dB` intensity calibration instead of
  reusing the Spectrum display-axis default.

**Touched areas**

- `src/lib/panelControls.js`: defaults and range normalization.
- `src/config/scales.js`: default Spectrum display mapping plus separate Spectrogram color
  constants.
- `src/components/PanelSettingsContent.jsx`: shared compact endpoint range input and panel settings
  rows, including Spectrum X range.
- `src/components/panels/SpectrumPanel.jsx`: uses normalized per-panel Y-axis endpoints.
- `src/hooks/useSpectrogramCanvas.js` and `src/theme/spectrogramColormap.js`: use dedicated
  Spectrogram color range constants.

**Verification**

```bash
npm run test -- src/lib/panelControls.test.js src/config/scales.test.js src/analysis/analysisRequests.test.js src/components/PanelSettingsContent.test.jsx src/components/panels/SpectrumPanel.test.jsx src/theme/spectrogramColormap.test.js src/hooks/useSpectrogramCanvas.test.jsx
```
