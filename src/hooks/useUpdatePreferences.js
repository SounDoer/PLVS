import { useCallback, useEffect, useState } from "react";
import { settingsStore, flushPersistence } from "../persistence/index.js";
import { changeUpdatePreferences, normalizeUpdatePreferences } from "../lib/updatePreferences.js";

const read = () => normalizeUpdatePreferences(settingsStore.read().updatePreferences);

export function useUpdatePreferences() {
  const [updatePreferences, setState] = useState(read);
  useEffect(() => settingsStore.subscribe(() => setState(read())), []);
  const setUpdatePreferences = useCallback(async (patch) => {
    const next = changeUpdatePreferences(read(), patch);
    settingsStore.patch({ updatePreferences: next });
    setState(next);
    await flushPersistence();
    return next;
  }, []);
  return { updatePreferences, setUpdatePreferences };
}
