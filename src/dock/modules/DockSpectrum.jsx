import { useCallback, useId, useRef, useState } from "react";
import {
  applySpectrumTilt,
  buildSpectrumSvgFromBandsAndDb,
  spectrumTiltOffsets,
} from "../../math/spectrumMath.js";
import { accumulateSpectrumMaxHold } from "../../math/spectrumMaxHold.js";
import { useFrameData } from "../../workspace/AudioDataContext.jsx";
import { dockSpectrumKey } from "../dockAnalysisRequest.js";

const VIEWBOX_WIDTH = 1000;
const VIEWBOX_HEIGHT = 260;

// The engine sends untilted rows; the slope tilt is display shaping and is applied here, the
// same way the workspace panel does it. See `spectrumTiltOffsets`.
function spectrumPath(result, valuesKey, tilt, range) {
  return buildSpectrumSvgFromBandsAndDb(
    result?.bandCentersHz ?? [],
    applySpectrumTilt(result?.[valuesKey] ?? [], tilt),
    range
  );
}

function areaPath(path) {
  return path ? `${path} L ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT} L 0 ${VIEWBOX_HEIGHT} Z` : "";
}

/** Compact live spectrum without axes or chart interactions. */
export function DockSpectrum({ controls }) {
  const { displayAudio } = useFrameData();
  const key = dockSpectrumKey(controls);
  const result = displayAudio?.spectrumResultsByKey?.[key];
  const maxMode = controls?.spectrumMaxMode ?? "off";
  const maxHoldEnabled = maxMode === "hold";
  const maxHoldIdentityRef = useRef(null);
  const maxHoldRef = useRef(null);
  const [maxHoldClearKey, setMaxHoldClearKey] = useState(0);
  const onMaxHoldClear = useCallback(() => setMaxHoldClearKey((value) => value + 1), []);
  // Reset during render, for the same reason the Workspace panel does: an effect would run after
  // this render had already folded a frame in.
  const maxHoldIdentity = `${key}|${maxHoldClearKey}|${maxHoldEnabled}`;
  if (maxHoldIdentityRef.current !== maxHoldIdentity) {
    maxHoldIdentityRef.current = maxHoldIdentity;
    maxHoldRef.current = null;
  }
  if (!maxHoldEnabled) {
    maxHoldRef.current = null;
  } else if (result?.smoothDb?.length) {
    maxHoldRef.current = accumulateSpectrumMaxHold(maxHoldRef.current, result.smoothDb);
  }
  const gradientId = useId().replaceAll(":", "");
  const primaryGradientId = `dock-spectrum-primary-${gradientId}`;
  const secondaryGradientId = `dock-spectrum-secondary-${gradientId}`;
  const range = {
    minHz: controls?.spectrumXMinFreq,
    maxHz: controls?.spectrumXMaxFreq,
    yMinDb: controls?.spectrumYMinDb,
    yMaxDb: controls?.spectrumYMaxDb,
  };
  const tilt = spectrumTiltOffsets(result?.bandCentersHz, controls?.spectrumTiltDbPerOctave);
  const livePath = spectrumPath(result, "smoothDb", tilt, range);
  const livePathB = spectrumPath(result, "smoothDbB", tilt, range);
  const peakPath = spectrumPath(result, "peakDb", tilt, range);
  const peakPathB = spectrumPath(result, "peakDbB", tilt, range);
  // The Dock has no snapshot, so the hold is the live one or nothing. Only the primary curve
  // carries it: the strip draws the secondary fill from the engine's peak either way.
  const maxHoldPath =
    maxHoldEnabled && maxHoldRef.current
      ? buildSpectrumSvgFromBandsAndDb(
          result?.bandCentersHz ?? [],
          applySpectrumTilt(Array.from(maxHoldRef.current), tilt),
          range
        )
      : "";
  const maxContourPath = maxHoldEnabled ? maxHoldPath : peakPath;
  const primaryAreaPath = areaPath(maxMode !== "off" && maxContourPath ? maxContourPath : livePath);
  const secondaryAreaPath = maxMode !== "off" ? areaPath(peakPathB) : "";

  return (
    <div
      data-max-hold-reset={maxHoldEnabled ? "true" : undefined}
      className={`h-full min-w-0 flex-1 px-[var(--ui-dock-pad-x)] py-[var(--ui-dock-pad-y)] ${
        maxHoldEnabled ? "cursor-pointer" : ""
      }`}
      onClick={maxHoldEnabled ? onMaxHoldClear : undefined}
    >
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
            data-dock-spectrum-live=""
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
