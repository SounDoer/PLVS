import { useCallback, useEffect, useState } from "react";
import { settingsStore, flushPersistence } from "../persistence/index.js";
import { changeUpdatePreferences, normalizeUpdatePreferences } from "../lib/updatePreferences.js";

const read = () => normalizeUpdatePreferences(settingsStore.read().updatePreferences);

export function useUpdatePreferences() {
  const [updatePreferences, setState] = useState(read);
  useEffect(() => settingsStore.subscribe(() => setState(read())), []);
  const setUpdatePreferences = useCallback(async (patch) => {
    const previous = read();
    const next = changeUpdatePreferences(previous, patch);
    settingsStore.patch({ updatePreferences: next });
    try {
      await flushPersistence();
    } catch (error) {
      settingsStore.patch({ updatePreferences: previous });
      throw error;
    }
    setState(next);
    return next;
  }, []);
  return { updatePreferences, setUpdatePreferences };
}
