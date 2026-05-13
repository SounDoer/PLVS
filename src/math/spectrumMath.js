import { freqToXFrac, spectrumDbToYViewBox } from "../config/scales";

const SPECTRUM_VIEW_W = 1000;

export function smoothingPreset(mode) {
  if (mode === "fast") return { attackMs: 30, releaseMs: 150 };
  if (mode === "slow") return { attackMs: 120, releaseMs: 700 };
  return { attackMs: 60, releaseMs: 300 };
}

export function smoothByKernel(values, kernel) {
  if (!Array.isArray(values) || values.length < 3) return values;
  if (!Array.isArray(kernel) || kernel.length < 3) return values;
  const out = values.slice();
  const radius = Math.floor(kernel.length / 2);
  const sum = kernel.reduce((a, b) => a + b, 0) || 1;
  for (let i = 0; i < values.length; i++) {
    let acc = 0;
    for (let k = 0; k < kernel.length; k++) {
      const idx = Math.max(0, Math.min(values.length - 1, i + k - radius));
      acc += values[idx] * kernel[k];
    }
    out[i] = acc / sum;
  }
  return out;
}

export function dbPathFromBands(bands, dbList) {
  if (
    !Array.isArray(bands) ||
    !Array.isArray(dbList) ||
    !bands.length ||
    bands.length !== dbList.length
  )
    return "";
  const pts = [];
  for (let i = 0; i < bands.length; i++) {
    const x = freqToXFrac(bands[i].fCenter) * SPECTRUM_VIEW_W;
    const y = spectrumDbToYViewBox(dbList[i]);
    pts.push(`${x.toFixed(2)} ${y.toFixed(2)}`);
  }
  return pts.length ? `M ${pts.join(" L ")}` : "";
}
