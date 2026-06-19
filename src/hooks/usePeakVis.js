import { peakFromTopFrac, PEAK_DB_MIN, PEAK_DB_MAX } from "../config/scales.js";
import { samplePeakLineColor } from "../math/colorMath.js";
import { UI_PREFERENCES } from "../preferences/data.js";
import { buildThemeTokens } from "../theme/buildThemeTokens.js";
import { getBuiltinTheme } from "../theme/builtinThemes.js";

/**
 * Peak meter line colour (sample-accurate) and True-peak HUD strings.
 * @param {string} resolvedThemeId
 * @param {{ tpMax?: number }} displayAudio
 */
export function usePeakVis(resolvedThemeId, displayAudio) {
  const fmt = (v) => (Number.isFinite(v) ? v.toFixed(1) : "-");
  const theme = getBuiltinTheme(resolvedThemeId);
  const tokens = buildThemeTokens(theme);
  const meterGradientCfg = {
    top: tokens["--ui-meter-gradient-top"],
    mid: tokens["--ui-meter-gradient-mid"],
    bottom: tokens["--ui-meter-gradient-bottom"],
    midStopPercent: UI_PREFERENCES.modules.peak.meterGradient.midStopPercent,
  };
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
