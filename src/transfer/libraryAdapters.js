/// The only module that knows the three libraries' container shapes. They are genuinely different
/// -- a blob inside settings, a list beside a selection pointer, and a map beside an order array --
/// and `mergeIntoLibrary.js` deliberately never sees which is which.
///
/// Import is append-only (see the spec), so two operations are enough. Nothing here removes or
/// overwrites, and nothing here touches a selection: `active`, `activeId`, `dirty` and
/// `settings.themeId` are all left exactly as they were.

import { presetsStore, settingsStore } from "../persistence/index.js";
import { normalizeLoudnessProfiles } from "../lib/loudnessProfileNormalize.js";
import { listCustomThemesOrdered, upsertCustomTheme } from "../theme/customThemesRepo.js";
import { hasKnownModulesOnly } from "../workspace/panelInstances.js";

const adapters = {
  loudness: {
    list() {
      return normalizeLoudnessProfiles(settingsStore.read().loudnessProfiles).profiles;
    },
    append(items) {
      if (items.length === 0) return;
      const current = normalizeLoudnessProfiles(settingsStore.read().loudnessProfiles);
      settingsStore.patch({
        loudnessProfiles: { ...current, profiles: [...current.profiles, ...items] },
      });
    },
  },
  presets: {
    list() {
      const raw = presetsStore.read();
      return (Array.isArray(raw.list) ? raw.list : []).filter(hasKnownModulesOnly);
    },
    append(items) {
      if (items.length === 0) return;
      const raw = presetsStore.read();
      const list = Array.isArray(raw.list) ? raw.list : [];
      presetsStore.patch({ list: [...list, ...items] });
    },
  },
  themes: {
    list() {
      return listCustomThemesOrdered();
    },
    append(items) {
      for (const theme of items) upsertCustomTheme(theme);
    },
  },
};

export function getAdapter(type) {
  const adapter = adapters[type];
  if (!adapter) throw new Error(`Unknown library type: ${type}`);
  return adapter;
}
