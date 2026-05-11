import { useEffect, useRef, useState } from "react";
import {
  UI_PREFERENCES,
  applyUiPreferencesToDocument,
  readPersistedUiMode,
  readSystemPrefersDark,
  resolveEffectiveUiMode,
} from "../uiPreferences";
import { getDefaultLoudnessReferenceProfileId, normalizeLoudnessReferenceProfileId } from "../loudnessReferenceProfiles";

export function useSettings() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [uiMode, setUiMode] = useState(() => readPersistedUiMode());
  const [systemPrefersDark, setSystemPrefersDark] = useState(() => readSystemPrefersDark());
  const [referenceProfileId, setReferenceProfileId] = useState(() => {
    try {
      const raw = localStorage.getItem(UI_PREFERENCES.layoutPersistKey);
      if (!raw) return getDefaultLoudnessReferenceProfileId();
      const s = JSON.parse(raw);
      return normalizeLoudnessReferenceProfileId(s.referenceProfileId);
    } catch (_) {}
    return getDefaultLoudnessReferenceProfileId();
  });
  const effectiveUiMode = resolveEffectiveUiMode(uiMode, systemPrefersDark);
  const uiModeRef = useRef(effectiveUiMode);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setSystemPrefersDark(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    uiModeRef.current = effectiveUiMode;
  }, [effectiveUiMode]);

  useEffect(() => {
    applyUiPreferencesToDocument(UI_PREFERENCES, effectiveUiMode);
  }, [effectiveUiMode]);

  return {
    settingsOpen,
    setSettingsOpen,
    /** Stored preference: follow OS, force dark, or force light */
    uiMode,
    setUiMode,
    /** Resolved `"dark"` | `"light"` for charts and CSS */
    effectiveUiMode,
    referenceProfileId,
    setReferenceProfileId,
    uiModeRef,
  };
}
