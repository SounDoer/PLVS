import { readLocalRange, writeLocalRange } from "../workspace/axisViewports.js";

/** Adapt Dock instances to the same frequency viewport contract used by Workspace panels. */
export function dockFrequencyViewport(moduleId, controls, shared, onSharedChange, onChange) {
  const local = readLocalRange("frequency", moduleId, controls);
  if (!local || !shared) return {};
  const linked = controls.linkFrequencyViewport !== false;
  const current = linked ? shared : local;
  return {
    axisViewports: { frequency: { ...current, linked } },
    setAxisViewportRange: (_kind, min, max) => {
      if (linked) onSharedChange?.({ min, max });
      else onChange?.({ ...controls, ...writeLocalRange("frequency", moduleId, { min, max }) });
    },
    setAxisViewportLinked: (_kind, nextLinked) =>
      onChange?.({
        ...controls,
        linkFrequencyViewport: nextLinked,
        ...(!nextLinked ? writeLocalRange("frequency", moduleId, current) : {}),
      }),
  };
}
