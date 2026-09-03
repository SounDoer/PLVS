import { DEFAULT_FOCUS_VIEW, normalizeFocusView } from "../lib/focusView.js";
import { normalizeDockControlsByPanelId } from "../dock/dockModuleControls.js";
import { normalizeDockLayout } from "../dock/dockLayout.js";
import { normalizeAxisViewportsState } from "../workspace/axisViewports.js";
import { MODULE_CATALOG } from "../workspace/moduleCatalog.js";
import { normalizePanelControlsById } from "../workspace/panelControlInstances.js";
import { resolvePanelDisplayName } from "../workspace/panelInstances.js";
import { readPublicPanelAxes } from "./panelAxes.js";
import { readPublicPanelControls } from "./panelControls.js";
import { serializeWorkspaceLayout } from "./workspaceLayout.js";

function savedProfileId(selection) {
  return typeof selection === "string" && selection.startsWith("profile:")
    ? selection.slice("profile:".length)
    : null;
}

function hasSavedLoudnessReference(preset, context) {
  const id = savedProfileId(preset.loudnessProfileActive);
  return (
    id !== null &&
    (context.loudnessProfiles ?? []).some(
      (profile) => profile?.id === id && Number.isFinite(profile.referenceLufs)
    )
  );
}

function buildSavedWorkspace(preset) {
  const panelsById = preset.panelsById ?? {};
  return {
    tree: preset.tree,
    panelsById,
    panelOrder: Array.isArray(preset.panelOrder) ? preset.panelOrder : [],
    panelControlsById: normalizePanelControlsById(panelsById, preset.panelControlsById),
    pinnedPanelsById: preset.pinnedPanelsById ?? {},
    axisViewports: normalizeAxisViewportsState(preset.axisViewports),
  };
}

function buildSavedDock(preset, context) {
  const raw = preset.dock ?? {};
  const layout = normalizeDockLayout(raw);
  const controlsByPanelId = normalizeDockControlsByPanelId(
    layout.panelsById,
    raw.controlsByPanelId
  );
  const hasLoudnessReference = hasSavedLoudnessReference(preset, context);
  return {
    enabled: raw.enabled === true,
    edge: raw.edge === "top" ? "top" : "bottom",
    monitor: typeof raw.monitor === "string" ? raw.monitor : null,
    reserveSpace: raw.reserveSpace === true,
    height: Number.isFinite(raw.height) ? raw.height : 72,
    panels: layout.panelOrder.map((panelId) => {
      const panel = layout.panelsById[panelId];
      const moduleId = panel.moduleId;
      const title =
        typeof panel.customTitle === "string" && panel.customTitle.trim()
          ? panel.customTitle.trim()
          : (MODULE_CATALOG[moduleId]?.title ?? (moduleId === "transport" ? "Timecode" : moduleId));
      const controls = MODULE_CATALOG[moduleId]
        ? readPublicPanelControls(moduleId, controlsByPanelId[panelId], {
            hasLoudnessReference,
          })
        : {};
      return {
        id: panelId,
        moduleId,
        title,
        width: layout.panelSizesById[panelId],
        controls,
      };
    }),
  };
}

export function buildPublicPresetSnapshot(preset, context = {}) {
  const workspace = buildSavedWorkspace(preset);
  const hasLoudnessReference = hasSavedLoudnessReference(preset, context);
  const focusView = normalizeFocusView(preset.focusView ?? DEFAULT_FOCUS_VIEW);
  return {
    id: String(preset.id),
    name: String(preset.name ?? "").trim(),
    workspace: {
      layout: serializeWorkspaceLayout(workspace),
      panels: workspace.panelOrder.map((panelId) => {
        const panel = workspace.panelsById[panelId];
        return {
          id: panelId,
          moduleId: panel.moduleId,
          title: resolvePanelDisplayName(workspace, panelId),
          controls: readPublicPanelControls(panel.moduleId, workspace.panelControlsById[panelId], {
            hasLoudnessReference,
          }),
          axes: readPublicPanelAxes(workspace, panelId, { writable: false }),
        };
      }),
    },
    window: {
      bounds: preset.windowBounds ?? null,
      pinned: preset.windowPinned === true,
      focusView,
      panelOpacity: Number.isFinite(preset.panelOpacity) ? preset.panelOpacity : 100,
      glassEnabled: preset.glassEnabled === true,
    },
    dock: buildSavedDock(preset, context),
    loudnessProfile: { activeId: savedProfileId(preset.loudnessProfileActive) },
  };
}
