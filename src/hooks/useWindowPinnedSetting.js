import { useCallback, useState } from "react";
import { presetsStore, settingsStore } from "../persistence/index.js";

/**
 * The stored always-on-top preference. Applying it to the window is `useAlwaysOnTop`, which has a
 * different owner: the Dock needs this value to restore the window, and the effect needs to know
 * whether the Dock is active.
 */
export function useWindowPinnedSetting() {
  const [windowPinned, setPinned] = useState(() => settingsStore.read().windowPinned === true);

  const setWindowPinned = useCallback((nextPinned) => {
    const next = nextPinned === true;
    settingsStore.patch({ windowPinned: next });
    presetsStore.patch({ dirty: true });
    setPinned(next);
  }, []);

  return { windowPinned, setWindowPinned };
}
