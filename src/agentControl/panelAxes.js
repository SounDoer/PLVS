import { axisKindsForModule, resolveAxisViewport } from "../workspace/axisViewports.js";

function publicRange(kindId, viewport) {
  if (kindId === "frequency") {
    return { minHz: viewport.min, maxHz: viewport.max };
  }
  return { windowSec: viewport.windowSec, offsetSec: viewport.offsetSec };
}

export function readPublicPanelAxes(workspace, panelId, { writable = false } = {}) {
  const moduleId = workspace?.panelsById?.[panelId]?.moduleId;
  return Object.fromEntries(
    axisKindsForModule(moduleId).map((kindId) => {
      const viewport = resolveAxisViewport(workspace, panelId, kindId);
      return [
        kindId,
        {
          linked: viewport.linked,
          source: viewport.linked ? "workspace" : "panel",
          writable,
          range: publicRange(kindId, viewport),
        },
      ];
    })
  );
}
