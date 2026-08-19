export function selectWaveformCanvasColors(resolved) {
  return {
    trace: resolved.canvas["waveform.trace"],
    snapshot: resolved.canvas["waveform.snapshot"],
    grid: resolved.canvas["waveform.grid"],
    frequencyLow: resolved.canvas["waveform.frequencyLow"],
    frequencyMid: resolved.canvas["waveform.frequencyMid"],
    frequencyHigh: resolved.canvas["waveform.frequencyHigh"],
    frequencyNeutral: resolved.canvas["waveform.frequencyNeutral"],
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
    good: resolved.roles["palette.status.good"],
    warning: resolved.roles["palette.status.warning"],
    critical: resolved.roles["palette.status.critical"],
  };
}

export function selectSpectrogramCanvasTheme(resolved) {
  return {
    intensityStops: resolved.roles["palette.intensity.stops"],
    ink: resolved.canvas["spectrogram.ink"],
    surfaceInk: resolved.canvas["spectrogram.surfaceInk"],
    grid: resolved.canvas["spectrogram.grid"],
    selection: resolved.canvas["spectrogram.selection"],
  };
}
