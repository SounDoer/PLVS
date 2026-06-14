# Spectrum Quick Wins Implementation Plan (Peak Hold + Note-name Hover)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two small, no-new-UI spectrum improvements — make the existing peak-hold line actually hold (route A, SPAN-style), and add a musical note name to the spectrum and spectrogram hover read-outs.

**Architecture:** Item 2 is an engine default-value change in `spectrum.rs` (the peak-hold mechanism already exists; only `peak_hold_sec` / `peak_decay_db_per_sec` defaults change). Item 5 adds a pure `freqToNote(f)` helper used by both the spectrum hover (computed in `SpectrumPanel.jsx`) and the spectrogram hover (computed in `hoverMath.computeSpectrogramHoverPoint`), each rendering one extra line.

**Tech Stack:** Rust (`spectrum.rs`), JS/Vitest, React panels.

**Source review:** `docs/superpowers/specs/2026-06-14-spectrum-multiresolution-fft-design.md` (item 1, separate). This plan covers the batched small tweaks only.

**Sequencing note:** Independent of the multi-resolution FFT rewrite (item 1). Task 1 changes the same `SpectrumMeter::new` default fields that exist both before and after item 1, so it applies in either order. If both plans are in flight, land Task 1 after item 1's Task 5 to avoid a merge conflict in `SpectrumMeter::new`.

**Considered but out of scope (from the item-by-item review):**
- **Item 3 — Window function:** keep Hann. Pro-Q doesn't expose window choice; Hann is a solid all-round default for music monitoring. Blackman-Harris (high dynamic range) / Flat-top (exact level) are niche/measurement use; add a Blackman-Harris option only if ever wanted, in a future UI-controls batch.
- **Item 4 — Frequency range / zoom:** keep fixed 20 Hz–20 kHz. Horizontal zoom is UI-heavy and not even done by Pro-Q; upper-bound extension to Nyquist (ultrasonic/aliasing QC) has marginal value for music and would reshape the x-axis — defer to a future "show to Nyquist" toggle in the UI batch.
- **Item 6 — Multichannel overlay (L/R, M/S, per-channel curves):** own future spec, after item 1. Needs engine re-architecture to N output curves (CPU ×N, array payload) plus a UI mode selector — not a small tweak.
- **Peak Hold "infinite / Max" mode + manual clear:** needs state + a button; deferred to the UI-controls batch. This plan only enables a timed hold default.
- **Configurable A4 reference (432/442/415 Hz):** needs a setting; deferred to the UI batch. This plan hardcodes A4 = 440 Hz.

**Test commands (PowerShell, Windows):**
- Rust: `cargo test --manifest-path src-tauri/Cargo.toml <name> -- --nocapture`
- JS: `npm test -- src/math/hoverMath.test.js`

---

## Task 1: Enable a real peak-hold default (route A)

**Files:**
- Modify: `src-tauri/src/dsp/spectrum.rs` (`SpectrumMeter::new`, currently around lines 193-194)

The peak-hold logic already runs (`spectrum.rs` ~lines 398-403): a peak is held until `peak_hold_until`, then decays at `peak_decay_db_per_sec`. Today `peak_hold_sec = 0.0`, so the peak decays the instant it is set — no visible hold. Give it a real hold time and a gentler fall.

- [ ] **Step 1: Write the failing test**

Add to the `#[cfg(test)]` block in `spectrum.rs`:

```rust
#[test]
fn peak_hold_default_holds_then_decays() {
  let sr = 48000.0;
  let m = SpectrumMeter::new(sr);
  assert!(m.peak_hold_sec >= 1.0, "peak hold should be enabled by default, got {}", m.peak_hold_sec);
  assert!(
    m.peak_decay_db_per_sec > 0.0 && m.peak_decay_db_per_sec <= 10.0,
    "decay should be gentle, got {}",
    m.peak_decay_db_per_sec
  );
}
```

Note: the test reads private fields, so it must live in the same module's `tests` submodule (it already does via `use super::*`).

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml peak_hold_default_holds -- --nocapture`
Expected: FAIL — `peak_hold_sec` is currently `0.0`.

- [ ] **Step 3: Change the defaults**

In `SpectrumMeter::new`, change:

```rust
      peak_hold_sec: 0.0,
      peak_decay_db_per_sec: 12.0,
```

to:

```rust
      peak_hold_sec: 1.5,
      peak_decay_db_per_sec: 8.0,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test --manifest-path src-tauri/Cargo.toml peak_hold_default_holds -- --nocapture`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/dsp/spectrum.rs
git commit -m "feat(spectrum): enable timed peak-hold default (1.5s hold, 8 dB/s fall)"
```

Optional follow-up (not required, no new theme token introduced here): the peak dashed line in `SpectrumPanel.jsx` (~line 186) currently uses the same color as the live curve (`var(--ui-chart-spectrum-live)`). With a real hold it already separates visually; a color distinction can be added later alongside the UI-controls batch.

---

## Task 2: `freqToNote` pure helper

**Files:**
- Modify: `src/math/hoverMath.js`
- Test: `src/math/hoverMath.test.js`

- [ ] **Step 1: Write the failing test**

Add to `src/math/hoverMath.test.js`:

```js
import { freqToNote } from "./hoverMath.js";

describe("freqToNote", () => {
  it("maps standard pitches at A4=440", () => {
    expect(freqToNote(440)).toBe("A4");
    expect(freqToNote(880)).toBe("A5");
    expect(freqToNote(261.6256)).toBe("C4"); // middle C
  });
  it("shows cents offset when off-pitch", () => {
    expect(freqToNote(445)).toMatch(/^A4 \+\d+¢$/);
    expect(freqToNote(437)).toMatch(/^A4 -\d+¢$/);
  });
  it("handles invalid input", () => {
    expect(freqToNote(0)).toBe("-");
    expect(freqToNote(NaN)).toBe("-");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/math/hoverMath.test.js`
Expected: FAIL — `freqToNote` is not exported.

- [ ] **Step 3: Implement `freqToNote`**

Add to `src/math/hoverMath.js`:

```js
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/**
 * Maps a frequency in Hz to a musical note name (A4 = 440 Hz reference).
 * Returns e.g. "A4", "C4", or "A4 +20¢" when off-pitch. "-" for invalid input.
 * @param {number} freq
 * @returns {string}
 */
export function freqToNote(freq) {
  if (!Number.isFinite(freq) || freq <= 0) return "-";
  const midi = 69 + 12 * Math.log2(freq / 440); // A4 = MIDI 69
  const rounded = Math.round(midi);
  const cents = Math.round((midi - rounded) * 100);
  const name = NOTE_NAMES[((rounded % 12) + 12) % 12];
  const octave = Math.floor(rounded / 12) - 1; // MIDI: C4 = 60 → octave 4
  const centStr = cents === 0 ? "" : ` ${cents > 0 ? "+" : ""}${cents}¢`;
  return `${name}${octave}${centStr}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/math/hoverMath.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/math/hoverMath.js src/math/hoverMath.test.js
git commit -m "feat(spectrum): add freqToNote helper (A4=440)"
```

---

## Task 3: Note line in the spectrum hover HUD

**Files:**
- Modify: `src/components/panels/SpectrumPanel.jsx`

The hover object is built in the `useChartHover` callback (~lines 30-42) and rendered in the HUD popover (~lines 218-225). Add `noteLabel` to the object and one more rendered line.

- [ ] **Step 1: Add `freqToNote` to the import**

The panel imports from `../../math/hoverMath`. Update that import to include `freqToNote`:

```js
import { computeSpectrumHoverIndex, formatSpectrumFreq, freqToNote } from "../../math/hoverMath";
```

- [ ] **Step 2: Add `noteLabel` to the hover object**

In the `useChartHover` callback return (the object with `freqLabel` / `dbLabel`), add:

```js
      noteLabel: freqToNote(band.fCenter),
```

- [ ] **Step 3: Render the note line**

In the HUD popover, after the `dbLabel` div (~line 222-224), add:

```jsx
                    <div className="font-[family-name:var(--ui-font-mono)] tabular-nums">
                      {spectrumHover.noteLabel}
                    </div>
```

- [ ] **Step 4: Verify in the app**

Run the app and hover the spectrum: the popover now shows freq, dB, and note (e.g. `A4`). Covered end-to-end by Task 5's manual check; no unit test (pure-render change over the tested helper).

- [ ] **Step 5: Commit**

```bash
git add src/components/panels/SpectrumPanel.jsx
git commit -m "feat(spectrum): show note name in spectrum hover HUD"
```

---

## Task 4: Note line in the spectrogram hover HUD

**Files:**
- Modify: `src/math/hoverMath.js` (`computeSpectrogramHoverPoint`)
- Modify: `src/components/panels/SpectrogramPanel.jsx`
- Test: `src/math/hoverMath.test.js`

`computeSpectrogramHoverPoint` already returns `freqLabel` / `dbLabel` (~lines 161-167) and computes `hz` (~line 142). Add `noteLabel`.

- [ ] **Step 1: Write the failing test**

Add to `src/math/hoverMath.test.js`:

```js
import { computeSpectrogramHoverPoint } from "./hoverMath.js";

it("includes a note label in spectrogram hover", () => {
  const snaps = [{ bands: [{ fCenter: 440 }], dbList: [-20] }];
  // yFrac chosen so hzFromFrac(1 - yFrac) lands near 440 Hz; nearest band is the only one.
  const out = computeSpectrogramHoverPoint(1, 0.5, snaps, 0, 1, 0.1);
  expect(out).not.toBeNull();
  expect(typeof out.noteLabel).toBe("string");
  expect(out.noteLabel).not.toBe("");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/math/hoverMath.test.js`
Expected: FAIL — `noteLabel` is `undefined`.

- [ ] **Step 3: Add `noteLabel` to the return**

In `computeSpectrogramHoverPoint`, the return object (~line 161) gains one field. Use the resolved band center for note naming (matches the displayed `db`), falling back to `hz`:

```js
  return {
    leftPct: xFrac * 100,
    topPct: yFrac * 100,
    timeLabel: formatHoverOffset(offsetSec),
    freqLabel: formatSpectrumFreq(hz),
    dbLabel: Number.isFinite(db) ? `${db.toFixed(1)} dB` : "-",
    noteLabel: freqToNote(bands[lo]?.fCenter ?? hz),
  };
```

`freqToNote` is defined in the same file (Task 2), so no import is needed.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/math/hoverMath.test.js`
Expected: PASS.

- [ ] **Step 5: Render the note line in the panel**

In `src/components/panels/SpectrogramPanel.jsx`, after the `dbLabel` div (~lines 225-227), add:

```jsx
                    <div className="font-[family-name:var(--ui-font-mono)] tabular-nums">
                      {spectrogramHover.noteLabel}
                    </div>
```

- [ ] **Step 6: Commit**

```bash
git add src/math/hoverMath.js src/math/hoverMath.test.js src/components/panels/SpectrogramPanel.jsx
git commit -m "feat(spectrum): show note name in spectrogram hover HUD"
```

---

## Task 5: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Rust suite**

Run: `cargo test --manifest-path src-tauri/Cargo.toml spectrum`
Expected: PASS, including `peak_hold_default_holds_then_decays`.

- [ ] **Step 2: JS suite**

Run: `npm test -- src/math/hoverMath.test.js`
Expected: PASS. Then `npm test` for the full suite.

- [ ] **Step 3: Manual check (build + run)**

Run the app. Then:
1. Play transient-rich audio (e.g. drums): the dashed peak line now visibly holds each frequency's peak ~1.5 s before falling, instead of clinging to the live curve.
2. Hover the spectrum: popover shows freq, dB, and note (440 Hz → `A4`).
3. Hover the spectrogram: popover shows time, freq, dB, and note.

---

## Self-review notes

- **Coverage:** Item 2 (Task 1), item 5 spectrum hover (Tasks 2-3), item 5 spectrogram hover (Task 4), verification (Task 5). Items 3/4/6 + infinite-hold + configurable-A4 recorded in "Considered but out of scope".
- **Type consistency:** `freqToNote(freq) -> string` defined in Task 2, consumed in Tasks 3 (`SpectrumPanel`) and 4 (`computeSpectrogramHoverPoint`, same file — no import). Hover objects gain `noteLabel`, rendered as `spectrumHover.noteLabel` / `spectrogramHover.noteLabel`.
- **Placeholders:** none — every code/test step has concrete content.
