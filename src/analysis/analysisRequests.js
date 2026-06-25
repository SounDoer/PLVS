import { normalizePanelControls } from "../lib/panelControls.js";
import { getPanelControls } from "../workspace/panelControlInstances.js";
import { resolvePanelModuleId } from "../workspace/panelInstances.js";

export const MAX_SPECTRUM_REQUESTS = 4;
export const MAX_VECTORSCOPE_REQUESTS = 4;

function spectrumDisplayControlsFromControls(panelControls) {
  const controls = normalizePanelControls(panelControls);
  const smoothingPercent = Math.round(controls.spectrumSmoothingPercent);
  const tiltDbPerOctave = Math.round(controls.spectrumTiltDbPerOctave * 100) / 100;
  const tiltCentidb = Math.round(tiltDbPerOctave * 100);
  return { smoothingPercent, tiltDbPerOctave, tiltCentidb };
}

function collectPanelIdsFromTree(node, panelsById, out = []) {
  if (!node) return out;
  if (node.type === "leaf") {
    for (const id of node.tabs) {
      if (panelsById?.[id]) out.push(id);
    }
    return out;
  }
  for (const child of node.children ?? []) collectPanelIdsFromTree(child, panelsById, out);
  return out;
}

export function spectrumRequestKeyFromControls(panelControls) {
  const controls = normalizePanelControls(panelControls);
  const view = controls.spectrumView ?? "combined";
  const sel = controls.spectrumChannel;
  const display = spectrumDisplayControlsFromControls(controls);
  const suffix = `sm${display.smoothingPercent}:tilt${display.tiltCentidb}`;
  if (sel?.type === "single") return `spectrum:single:${sel.ch}:combined:${suffix}`;
  return `spectrum:pair:${sel?.x ?? 0}:${sel?.y ?? 1}:${view}:${suffix}`;
}

export function vectorscopeRequestKeyFromControls(panelControls) {
  const controls = normalizePanelControls(panelControls);
  const pair = controls.vectorscopePair ?? { x: 0, y: 1 };
  return `vectorscope:pair:${pair.x}:${pair.y}`;
}

function pushRequest(map, key, panelId, payload) {
  const existing = map.get(key);
  if (existing) {
    existing.panelIds.push(panelId);
    return;
  }
  map.set(key, { key, panelIds: [panelId], ...payload });
}

function capRequests(requests, max, statusByPanelId) {
  const active = requests.slice(0, max);
  const overCap = requests.slice(max);
  for (const request of overCap) {
    for (const panelId of request.panelIds) {
      statusByPanelId[panelId] = "overCap";
    }
  }
  return { active, overCap };
}

export function deriveAnalysisRequests(state) {
  const panelIdsInTree = collectPanelIdsFromTree(state.tree, state.panelsById);
  const orderedPanelIds = (state.panelOrder ?? []).filter((id) => panelIdsInTree.includes(id));
  const statusByPanelId = {};
  const spectrumByKey = new Map();
  const vectorscopeByKey = new Map();

  for (const panelId of orderedPanelIds) {
    const moduleId = resolvePanelModuleId(state, panelId);
    const controls = getPanelControls(state, panelId);
    if (moduleId === "spectrum" || moduleId === "spectrogram") {
      const key = spectrumRequestKeyFromControls(controls);
      const display = spectrumDisplayControlsFromControls(controls);
      pushRequest(spectrumByKey, key, panelId, {
        channel: controls.spectrumChannel,
        view: controls.spectrumChannel?.type === "single" ? "combined" : controls.spectrumView,
        smoothingPercent: display.smoothingPercent,
        tiltDbPerOctave: display.tiltDbPerOctave,
      });
      statusByPanelId[panelId] = "active";
    } else if (moduleId === "vectorscope") {
      const key = vectorscopeRequestKeyFromControls(controls);
      pushRequest(vectorscopeByKey, key, panelId, {
        pair: controls.vectorscopePair,
      });
      statusByPanelId[panelId] = "active";
    }
  }

  const spectrum = capRequests([...spectrumByKey.values()], MAX_SPECTRUM_REQUESTS, statusByPanelId);
  const vectorscope = capRequests(
    [...vectorscopeByKey.values()],
    MAX_VECTORSCOPE_REQUESTS,
    statusByPanelId
  );

  return {
    spectrumRequests: spectrum.active,
    vectorscopeRequests: vectorscope.active,
    overCapSpectrumRequests: spectrum.overCap,
    overCapVectorscopeRequests: vectorscope.overCap,
    statusByPanelId,
  };
}
