import { useFrameData } from "../../workspace/AudioDataContext.jsx";
import { buildSpectrumSvgFromBandsAndDb } from "../../math/spectrumMath.js";
import { dockSpectrumKey } from "../dockAnalysisRequest.js";

/** Compact fixed-scale RTA: the backend spectrum path, no axes. */
export function DockSpectrum({ controls }) {
  const { displayAudio } = useFrameData();
  const result = displayAudio?.spectrumResultsByKey?.[dockSpectrumKey(controls)];
  const range = { yMinDb: controls?.minDb, yMaxDb: controls?.maxDb };
  const path =
    buildSpectrumSvgFromBandsAndDb(result?.bandCentersHz ?? [], result?.smoothDb ?? [], range) ||
    (typeof result?.path === "string" ? result.path : "");
  const peakPath =
    buildSpectrumSvgFromBandsAndDb(result?.bandCentersHz ?? [], result?.peakDb ?? [], range) ||
    (typeof result?.peakPath === "string" ? result.peakPath : "");
  return (
    <div className="h-full min-w-0 flex-1 px-1 py-[6px]">
      <svg
        viewBox="0 0 1000 260"
        preserveAspectRatio="none"
        className="h-full w-full"
        aria-hidden="true"
      >
        {path ? (
          <path
            d={`${path} L 1000 260 L 0 260 Z`}
            fill="var(--ui-spectrum-primary)"
            opacity="0.5"
          />
        ) : null}
        {controls?.peakHold && peakPath ? (
          <path d={peakPath} fill="none" stroke="var(--ui-spectrum-secondary)" />
        ) : null}
      </svg>
    </div>
  );
}
