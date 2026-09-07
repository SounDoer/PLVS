import { readPublicPanelControls } from "./panelControls.js";
import { buildPublicPanelControlSchema } from "./panelControlSchema.js";
import { createDefaultPanelControls } from "../workspace/panelControlInstances.js";
import { axisKindsForModule } from "../workspace/axisViewports.js";
import { MODULE_CATALOG } from "../workspace/moduleCatalog.js";

export function buildModuleList() {
  return Object.values(MODULE_CATALOG).map((module) => ({
    moduleId: module.id,
    title: module.title,
  }));
}

export function buildModuleDescription(moduleId, context = {}) {
  const module = MODULE_CATALOG[moduleId];
  if (!module) return null;

  const defaults = createDefaultPanelControls();
  return {
    moduleId: module.id,
    title: module.title,
    layout: {
      hardMinimumWidth: module.minWidth,
      hardMinimumHeight: module.minHeight,
      unit: "logicalPx",
    },
    axisKinds: axisKindsForModule(moduleId),
    defaultControls: readPublicPanelControls(moduleId, defaults, context),
    controlsSchema: buildPublicPanelControlSchema(moduleId, defaults, context),
  };
}

export function buildModuleDescriptionContext(analysisContext = {}, hasLoudnessReference = false) {
  const detectedChannelCount =
    Number.isInteger(analysisContext.channelCount) && analysisContext.channelCount > 0
      ? analysisContext.channelCount
      : null;
  return {
    channelTopology: {
      status: detectedChannelCount === null ? "assumed" : "detected",
      channelCount: detectedChannelCount ?? 2,
    },
    hasLoudnessReference: hasLoudnessReference === true,
  };
}
