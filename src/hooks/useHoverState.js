import { useState } from "react";
import { loudnessFromTopFrac, freqToXFrac, spectrumDbToTopFrac } from "../config/scales";

function formatHoverOffset(sec) {
  const s = Math.max(0, sec);
  if (s >= 60) {
    const m = Math.floor(s / 60);
    const rem = s - m * 60;
    return `${m}m ${rem.toFixed(rem >= 10 ? 0 : 1)}s ago`;
  }
  return `${s.toFixed(s >= 10 ? 0 : 1)}s ago`;
}

function formatSpectrumFreq(freq) {
  if (!Number.isFinite(freq)) return "-";
  if (freq >= 1000) {
    const khz = freq / 1000;
    return `${khz >= 10 ? khz.toFixed(1) : khz.toFixed(2)} kHz`;
  }
  return `${Math.round(freq)} Hz`;
}

export function useHoverState({
  historyChartInteractive,
  histSourceList,
  effectiveOffsetSamples,
  visibleSamples,
  sampleSec,
  displaySpectrumData,
}) {
  const [historyHover, setHistoryHover] = useState(null);
  const [spectrumHover, setSpectrumHover] = useState(null);

  const onHistoryHoverMove = (clientX, rect) => {
    if (!historyChartInteractive) {
      setHistoryHover(null);
      return;
    }
    if (!histSourceList.length) {
      setHistoryHover(null);
      return;
    }
    const width = Math.max(1, rect.width);
    const x = Math.max(0, Math.min(width, clientX - rect.left));
    const normalized = 1 - x / width;
    const fromEndSamples = effectiveOffsetSamples + normalized * Math.max(0, visibleSamples - 1);
    const hoverIndex = Math.max(
      0,
      Math.min(histSourceList.length - 1, histSourceList.length - 1 - Math.round(fromEndSamples))
    );
    const point = histSourceList[hoverIndex];
    if (!point) {
      setHistoryHover(null);
      return;
    }
    const offsetSec = Math.max(0, (histSourceList.length - 1 - hoverIndex) * sampleSec);
    const yValue = Number.isFinite(point.st) ? point.st : point.m;
    setHistoryHover({
      leftPct: (x / width) * 100,
      topPct: Number.isFinite(yValue) ? loudnessFromTopFrac(yValue) * 100 : null,
      momentary: Number.isFinite(point.m) ? point.m : null,
      shortTerm: Number.isFinite(point.st) ? point.st : null,
      offsetLabel: formatHoverOffset(offsetSec),
    });
  };

  const onHistoryHoverLeave = () => setHistoryHover(null);

  const onSpectrumHoverMove = (clientX, rect) => {
    const data = displaySpectrumData;
    if (!data?.bands?.length || !data?.dbList?.length) {
      setSpectrumHover(null);
      return;
    }
    const width = Math.max(1, rect.width);
    const x = Math.max(0, Math.min(width, clientX - rect.left));
    const xFrac = x / width;
    let nearestIdx = 0;
    let nearestDist = Infinity;
    for (let i = 0; i < data.bands.length; i += 1) {
      const dist = Math.abs(freqToXFrac(data.bands[i].fCenter) - xFrac);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestIdx = i;
      }
    }
    const band = data.bands[nearestIdx];
    const db = data.dbList[nearestIdx];
    if (!band || !Number.isFinite(db)) {
      setSpectrumHover(null);
      return;
    }
    setSpectrumHover({
      leftPct: freqToXFrac(band.fCenter) * 100,
      topPct: spectrumDbToTopFrac(db) * 100,
      freqLabel: formatSpectrumFreq(band.fCenter),
      dbLabel: `${db.toFixed(1)} dB`,
    });
  };

  const onSpectrumHoverLeave = () => setSpectrumHover(null);

  const clearHoverState = () => {
    setHistoryHover(null);
    setSpectrumHover(null);
  };

  return {
    historyHover,
    spectrumHover,
    onHistoryHoverMove,
    onHistoryHoverLeave,
    onSpectrumHoverMove,
    onSpectrumHoverLeave,
    clearHoverState,
  };
}
