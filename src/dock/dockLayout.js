import { STATS_CANONICAL_ORDER } from "../lib/statsCatalog.js";
import {
  DEFAULT_DOCK_CONTROLS_BY_MODULE_ID,
  normalizeDockStatsIds as normalizeDockStatsControlIds,
} from "./dockModuleControls.js";

/** Known dock module ids, in catalog order (kept in sync with registry.jsx). */
export const DOCK_MODULE_IDS = [
  "level",
  "loudness",
  "spectrum",
  "correlation",
  "stats",
  "waveform",
  "spectrogram",
  "transport",
];

/** v1 default set; later-phase modules are opt-in. */
export const DEFAULT_DOCK_MODULES = ["level", "loudness", "spectrum", "correlation"];

/** Normalize the persisted `dock` value from workspaceStore. */
export function normalizeDockLayout(raw) {
  const list = raw && typeof raw === "object" ? raw.modules : undefined;
  if (!Array.isArray(list)) return { modules: [...DEFAULT_DOCK_MODULES] };
  const seen = new Set();
  const modules = [];
  for (const id of list) {
    if (!DOCK_MODULE_IDS.includes(id) || seen.has(id)) continue;
    seen.add(id);
    modules.push(id);
  }
  return { modules };
}

export function toggleDockModule(layout, id) {
  if (!DOCK_MODULE_IDS.includes(id)) return layout;
  const modules = layout.modules.includes(id)
    ? layout.modules.filter((m) => m !== id)
    : [...layout.modules, id];
  return { ...layout, modules };
}

export function reorderDockModule(layout, fromIndex, toIndex) {
  const modules = [...layout.modules];
  const clamp = (i) => Math.max(0, Math.min(modules.length - 1, i));
  const from = clamp(fromIndex);
  const to = clamp(toIndex);
  if (from === to) return layout;
  const [moved] = modules.splice(from, 1);
  modules.splice(to, 0, moved);
  return { ...layout, modules };
}

/** Spec: DockStats shows 2-4 user-picked readouts; we allow 0-4 and default to 3. */
export const MAX_DOCK_STATS_IDS = 4;

export const DEFAULT_DOCK_STATS_IDS = [...DEFAULT_DOCK_CONTROLS_BY_MODULE_ID.stats.ids];

/** Normalize the persisted stats-readout selection. */
export function normalizeDockStatsIds(raw) {
  return normalizeDockStatsControlIds(raw);
}

export function toggleDockStatId(statsIds, id) {
  if (!STATS_CANONICAL_ORDER.includes(id)) return statsIds;
  if (statsIds.includes(id)) return statsIds.filter((s) => s !== id);
  if (statsIds.length >= MAX_DOCK_STATS_IDS) return statsIds;
  return [...statsIds, id];
}
