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
