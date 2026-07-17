import { useId } from "react";
import { buildSpectrumSvgFromBandsAndDb } from "../../math/spectrumMath.js";
import { useFrameData } from "../../workspace/AudioDataContext.jsx";
import { dockSpectrumKey } from "../dockAnalysisRequest.js";

const VIEWBOX_WIDTH = 1000;
const VIEWBOX_HEIGHT = 260;

function spectrumPath(result, valuesKey, fallbackKey, range) {
  return (
    buildSpectrumSvgFromBandsAndDb(result?.bandCentersHz ?? [], result?.[valuesKey] ?? [], range) ||
    (typeof result?.[fallbackKey] === "string" ? result[fallbackKey] : "")
  );
}

function areaPath(path) {
  return path ? `${path} L ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT} L 0 ${VIEWBOX_HEIGHT} Z` : "";
}

/** Compact live spectrum without axes or chart interactions. */
export function DockSpectrum({ controls }) {
  const { displayAudio } = useFrameData();
  const result = displayAudio?.spectrumResultsByKey?.[dockSpectrumKey(controls)];
  const gradientId = useId().replaceAll(":", "");
  const primaryGradientId = `dock-spectrum-primary-${gradientId}`;
  const secondaryGradientId = `dock-spectrum-secondary-${gradientId}`;
  const range = {
    minHz: controls?.minFreq,
    maxHz: controls?.maxFreq,
    yMinDb: controls?.minDb,
    yMaxDb: controls?.maxDb,
  };
  const livePath = spectrumPath(result, "smoothDb", "path", range);
  const livePathB = spectrumPath(result, "smoothDbB", "pathB", range);
  const peakPath = spectrumPath(result, "peakDb", "peakPath", range);
  const peakPathB = spectrumPath(result, "peakDbB", "peakPathB", range);
  const primaryAreaPath = areaPath(controls?.maxHold && peakPath ? peakPath : livePath);
  const secondaryAreaPath = controls?.maxHold ? areaPath(peakPathB) : "";

  return (
    <div className="h-full min-w-0 flex-1 px-[var(--ui-dock-pad-x)] py-[var(--ui-dock-pad-y)]">
      <svg
        viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
        preserveAspectRatio="none"
        className="block h-full min-h-0 w-full min-w-0"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id={primaryGradientId} x1="0" x2="0" y1="0" y2="1">
            <stop
              offset="0%"
              stopColor="var(--ui-spectrum-primary)"
              stopOpacity="var(--ui-spectrum-fill-top-opacity, 0.18)"
            />
            <stop
              offset="100%"
              stopColor="var(--ui-spectrum-primary)"
              stopOpacity="var(--ui-spectrum-fill-bottom-opacity, 0.02)"
            />
          </linearGradient>
          <linearGradient id={secondaryGradientId} x1="0" x2="0" y1="0" y2="1">
            <stop
              offset="0%"
              stopColor="var(--ui-spectrum-secondary)"
              stopOpacity="var(--ui-spectrum-fill-top-opacity, 0.18)"
            />
            <stop
              offset="100%"
              stopColor="var(--ui-spectrum-secondary)"
              stopOpacity="var(--ui-spectrum-fill-bottom-opacity, 0.02)"
            />
          </linearGradient>
        </defs>
        {primaryAreaPath ? <path d={primaryAreaPath} fill={`url(#${primaryGradientId})`} /> : null}
        {secondaryAreaPath ? (
          <path d={secondaryAreaPath} fill={`url(#${secondaryGradientId})`} />
        ) : null}
        {livePath ? (
          <path
            d={livePath}
            fill="none"
            stroke="var(--ui-spectrum-primary)"
            strokeWidth="var(--ui-spectrum-stroke-width)"
            vectorEffect="non-scaling-stroke"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : null}
        {livePathB ? (
          <path
            d={livePathB}
            fill="none"
            stroke="var(--ui-spectrum-secondary)"
            strokeWidth="var(--ui-spectrum-stroke-width)"
            vectorEffect="non-scaling-stroke"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : null}
      </svg>
    </div>
  );
}
