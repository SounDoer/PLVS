/** Known dock module ids, in registry order (kept in sync with registry.jsx). */
export const DOCK_MODULE_IDS = ["level", "loudness", "spectrum", "correlation"];

export const DEFAULT_DOCK_MODULES = [...DOCK_MODULE_IDS];

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
