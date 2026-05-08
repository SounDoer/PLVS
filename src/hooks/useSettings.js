import { useEffect, useRef, useState } from "react";
import { UI_PREFERENCES, applyUiPreferencesToDocument, readPersistedUiMode } from "../uiPreferences";
import { getDefaultLoudnessReferenceProfileId, normalizeLoudnessReferenceProfileId } from "../loudnessReferenceProfiles";

export function useSettings() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [uiMode, setUiMode] = useState(() => readPersistedUiMode());
  const [standard, setStandard] = useState(() => {
    try {
      const raw = localStorage.getItem(UI_PREFERENCES.layoutPersistKey);
      if (!raw) return "ebu";
      const s = JSON.parse(raw);
      if (s.standard === "ebu" || s.standard === "stream") return s.standard;
    } catch (_) {}
    return "ebu";
  });
  const [referenceProfileId, setReferenceProfileId] = useState(() => {
    try {
      const raw = localStorage.getItem(UI_PREFERENCES.layoutPersistKey);
      if (!raw) return getDefaultLoudnessReferenceProfileId();
      const s = JSON.parse(raw);
      return normalizeLoudnessReferenceProfileId(s.referenceProfileId);
    } catch (_) {}
    return getDefaultLoudnessReferenceProfileId();
  });
  const uiModeRef = useRef(uiMode);

  useEffect(() => {
    uiModeRef.current = uiMode;
  }, [uiMode]);

  useEffect(() => {
    applyUiPreferencesToDocument(UI_PREFERENCES, uiMode);
  }, [uiMode]);

  useEffect(() => {
    if (!settingsOpen) return;
    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setSettingsOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [settingsOpen]);

  return {
    settingsOpen,
    setSettingsOpen,
    uiMode,
    setUiMode,
    standard,
    setStandard,
    referenceProfileId,
    setReferenceProfileId,
    uiModeRef,
  };
}
