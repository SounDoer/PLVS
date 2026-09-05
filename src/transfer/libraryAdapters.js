/// The only module that knows the three libraries' container shapes. They are genuinely different
/// -- a blob inside settings, a list beside a selection pointer, and a map beside an order array --
/// and `mergeIntoLibrary.js` deliberately never sees which is which.
///
/// Import is append-only (see the spec), so two operations are enough. Nothing here removes or
/// overwrites an existing entry, and nothing here touches a selection: `active`, `activeId`,
/// `dirty` and `settings.themeId` are all left exactly as they were.

import { presetsStore, settingsStore, themesStore } from "../persistence/index.js";
import { normalizeRuleDocument } from "../lib/loudnessProfileNormalize.js";
import {
  listCustomThemes,
  listCustomThemesOrdered,
  upsertCustomTheme,
} from "../theme/customThemesRepo.js";
import { hasKnownModulesOnly } from "../workspace/panelInstances.js";

const adapters = {
  loudness: {
    // Reports what's in the library, not a normalized/repaired view: malformed entries are hidden
    // (each is run through `normalizeRuleDocument` individually, and de-duped by id) but nothing is
    // seeded and nothing is written back. Seeding an empty store is `LoudnessProfileContext`'s job.
    list() {
      const raw = settingsStore.read().loudnessProfiles;
      const profiles =
        raw && typeof raw === "object" && Array.isArray(raw.profiles) ? raw.profiles : [];
      const seenIds = new Set();
      return profiles
        .map((entry) => normalizeRuleDocument(entry))
        .filter((profile) => {
          if (!profile || seenIds.has(profile.id)) return false;
          seenIds.add(profile.id);
          return true;
        });
    },
    append(items) {
      if (items.length === 0) return;
      const raw = settingsStore.read().loudnessProfiles;
      const current = raw && typeof raw === "object" ? raw : {};
      const profiles = Array.isArray(current.profiles) ? current.profiles : [];
      settingsStore.patch({
        loudnessProfiles: { ...current, profiles: [...profiles, ...items] },
      });
      // `plvs:settings` does not announce a write to its own context, so without this the profile
      // list keeps rendering the library as it was before the import. See `notifyLocal`.
      settingsStore.notifyLocal();
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
      // `upsertCustomTheme` overwrites an existing id unconditionally -- correct for the theme
      // editor, its other caller, but not for import. `planMerge` already mints a fresh id for
      // any collision before `append` ever sees it, so this guard never fires today; it exists so
      // this adapter enforces its own non-destructive contract instead of borrowing one from a
      // caller that could change.
      const existing = listCustomThemes();
      const written = new Set();
      for (const theme of items) {
        if (theme && (Object.hasOwn(existing, theme.id) || written.has(theme.id))) continue;
        upsertCustomTheme(theme);
        if (theme) written.add(theme.id);
      }
      // Same reason as the loudness adapter: `plvs:themes` does not notify its own context, so the
      // theme picker would not show an imported theme until something else made it re-read.
      if (written.size > 0) themesStore.notifyLocal();
    },
  },
};

export function getAdapter(type) {
  const adapter = adapters[type];
  if (!adapter) throw new Error(`Unknown library type: ${type}`);
  return adapter;
}
