import { peakFromTopFrac, PEAK_DB_MIN, PEAK_DB_MAX } from "../scales.js";
import { samplePeakLineColor } from "../math/colorMath.js";
import { getBuiltinTheme } from "../theme/builtinThemes.js";

/**
 * Peak meter line colour (sample-accurate) and True-peak HUD strings for the main and float shells.
 * @param {string} resolvedThemeId
 * @param {{ tpMax?: number }} displayAudio
 */
export function usePeakVis(resolvedThemeId, displayAudio) {
  const fmt = (v) => (Number.isFinite(v) ? v.toFixed(1) : "-");
  const meterGradientCfg = getBuiltinTheme(resolvedThemeId).meterGradient;
  const getSamplePeakLineColor = (dbValue) =>
    samplePeakLineColor(
      dbValue,
      (v) => peakFromTopFrac(Math.max(PEAK_DB_MIN, Math.min(PEAK_DB_MAX, v))),
      meterGradientCfg
    );
  const hasTpMaxValue = Number.isFinite(displayAudio.tpMax);
  const tpMaxText = hasTpMaxValue ? `${displayAudio.tpMax.toFixed(1)} dBTP` : "-";
  return { fmt, getSamplePeakLineColor, hasTpMaxValue, tpMaxText };
}
