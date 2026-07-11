import { useFrameData } from "../../workspace/AudioDataContext.jsx";
import { DOCK_SPECTRUM_KEY } from "../dockAnalysisRequest.js";

/** Compact fixed-scale RTA: the backend spectrum path, no axes. */
export function DockSpectrum() {
  const { displayAudio } = useFrameData();
  const result = displayAudio?.spectrumResultsByKey?.[DOCK_SPECTRUM_KEY];
  const path = typeof result?.path === "string" && result.path ? result.path : "";
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
      </svg>
    </div>
  );
}
