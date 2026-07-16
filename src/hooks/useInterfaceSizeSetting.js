import { useEffect, useState } from "react";
import { settingsStore } from "../persistence/index.js";
import {
  UI_PREFERENCES,
  applyLayoutToDocument,
  normalizeInterfaceSize,
  readPersistedInterfaceSize,
  resolveInterfacePreferences,
} from "../uiPreferences.js";

export function useInterfaceSizeSetting() {
  const [interfaceSize, setInterfaceSizeState] = useState(readPersistedInterfaceSize);

  function setInterfaceSize(value) {
    const next = normalizeInterfaceSize(value);
    settingsStore.patch({ interfaceSize: next });
    setInterfaceSizeState(next);
  }

  useEffect(() => {
    applyLayoutToDocument(resolveInterfacePreferences(UI_PREFERENCES, interfaceSize));
  }, [interfaceSize]);

  useEffect(
    () =>
      settingsStore.subscribe(() => {
        setInterfaceSizeState(readPersistedInterfaceSize());
      }),
    []
  );

  return {
    interfaceSize,
    setInterfaceSize,
  };
}
