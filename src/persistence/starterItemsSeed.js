import { invoke } from "@tauri-apps/api/core";

/// Whether this installation has settled its first-run starter items -- the "Default" Loudness
/// Profile and the "Default" preset: seeded on a first run, or skipped because the installation
/// already existed. A global preference rather than workspace state, because both live in the one
/// library every workspace shares -- without it, a new workspace beside an emptied library looks
/// like a first run and brings back an item the user deleted. Only Reset PLVS to Default clears it
/// (`reset_session` in `src-tauri/src/profile.rs`). The preset reads it here; the profile reads
/// it through hydration, which leaves `profiles` out only while it is unset.
const KEY = "starterItemsSeeded";

function bootState() {
  return typeof window !== "undefined" ? window.__PLVS_INITIAL_STATE__ : undefined;
}

export function starterItemsSeeded() {
  return bootState()?.globalPreferences?.[KEY] === true;
}

// The profile provider and the presets hook both settle it on mount; they share one write.
let marking = null;

/// Backends without shared workspaces have nothing to record: there a stored workspace already
/// tells a first run from a later one.
export function markStarterItemsSeeded() {
  const initial = bootState();
  if (!initial?.multiInstancePersistence || starterItemsSeeded()) return Promise.resolve();
  marking ??= (async () => {
    try {
      const metadata = initial.multiInstancePersistence;
      const revisions = await invoke("persistence_save_global_preferences", {
        values: { [KEY]: true },
        expectedRevisions: { [KEY]: metadata.globalPreferenceRevisions?.[KEY] ?? 0 },
      });
      initial.globalPreferences = { ...(initial.globalPreferences || {}), [KEY]: true };
      metadata.globalPreferenceRevisions = {
        ...(metadata.globalPreferenceRevisions || {}),
        ...revisions,
      };
    } finally {
      marking = null;
    }
  })();
  return marking;
}
