import { BUILTIN_THEMES_V2 } from "./builtinThemesV2.js";
import { compileTheme } from "./compileTheme.js";

export function selectWaveformCanvasColors(resolved) {
  return {
    trace: resolved.canvas["waveform.trace"],
    snapshot: resolved.canvas["waveform.snapshot"],
    selection: resolved.canvas["waveform.selection"],
    frequencyLow: resolved.canvas["waveform.frequencyLow"],
    frequencyMid: resolved.canvas["waveform.frequencyMid"],
    frequencyHigh: resolved.canvas["waveform.frequencyHigh"],
    frequencyNeutral: resolved.canvas["waveform.frequencyNeutral"],
    frequencyLowHistory: resolved.canvas["waveform.frequencyLowHistory"],
    frequencyMidHistory: resolved.canvas["waveform.frequencyMidHistory"],
    frequencyHighHistory: resolved.canvas["waveform.frequencyHighHistory"],
    frequencyNeutralHistory: resolved.canvas["waveform.frequencyNeutralHistory"],
    centroid: resolved.canvas["waveform.centroid"],
  };
}

export function selectStereoMapCanvasColors(resolved) {
  return {
    primary: resolved.canvas["stereoMap.primary"],
    secondary: resolved.canvas["stereoMap.secondary"],
    primarySnapshot: resolved.canvas["stereoMap.primarySnapshot"],
    secondarySnapshot: resolved.canvas["stereoMap.secondarySnapshot"],
    grid: resolved.canvas["stereoMap.grid"],
    good: resolved.canvas["stereoMap.safeRange"],
    warning: resolved.canvas["stereoMap.warningRange"],
    critical: resolved.canvas["stereoMap.criticalRange"],
    goodHistory: resolved.canvas["stereoMap.safeRangeHistory"],
    warningHistory: resolved.canvas["stereoMap.warningRangeHistory"],
    criticalHistory: resolved.canvas["stereoMap.criticalRangeHistory"],
  };
}

export function selectSpectrogramCanvasTheme(resolved) {
  return {
    intensityStops: resolved.roles["palette.intensity.stops"],
    intensityStopsHistory: resolved.canvas["spectrogram.intensityHistory"],
    ink: resolved.canvas["spectrogram.ink"],
    inkHistory: resolved.canvas["spectrogram.inkHistory"],
    surfaceInk: resolved.canvas["spectrogram.surfaceInk"],
    surfaceInkHistory: resolved.canvas["spectrogram.surfaceInkHistory"],
    grid: resolved.canvas["spectrogram.grid"],
    axisLabel: resolved.canvas["spectrogram.axisLabel"],
    selection: resolved.canvas["spectrogram.selection"],
  };
}

export function selectVectorscopeCanvasColors(resolved) {
  return {
    trace: resolved.canvas["vectorscope.trace"],
    snapshot: resolved.canvas["vectorscope.snapshot"],
    guides: resolved.canvas["vectorscope.guides"],
  };
}

const FALLBACK_RESOLVED_THEME = compileTheme(BUILTIN_THEMES_V2["plvs-dark"]);

export const DEFAULT_WAVEFORM_CANVAS_COLORS = Object.freeze(
  selectWaveformCanvasColors(FALLBACK_RESOLVED_THEME)
);
export const DEFAULT_SPECTROGRAM_CANVAS_THEME = Object.freeze(
  selectSpectrogramCanvasTheme(FALLBACK_RESOLVED_THEME)
);
