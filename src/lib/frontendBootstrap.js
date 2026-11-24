import { assertTauriBuildEnvironment } from "../ipc/env.js";
import { listCustomThemes } from "../theme/customThemesRepo.js";
import {
  UI_PREFERENCES,
  applyLayoutToDocument,
  applyThemeToDocument,
  readPersistedInterfaceSize,
  readPersistedShellThemeFields,
  readSystemPrefersDark,
  resolveInterfacePreferencesForSurface,
  resolveThemeId,
} from "../uiPreferences.js";
import { installKeyboardNavigationTracking } from "./keyboardNavigation.js";

export function getFrontendRoot() {
  const root = document.getElementById("root");
  if (!root) throw new Error("PLVS frontend root is missing.");
  // Reject a browser-mode build inside Tauri before any migration or persistence write.
  try {
    assertTauriBuildEnvironment();
  } catch (error) {
    root.textContent = error.message;
    throw error;
  }
  return root;
}

/** @param {string | null} surface */
export function initializeDocumentPresentation(surface) {
  const shell = readPersistedShellThemeFields();
  const interfaceSize = readPersistedInterfaceSize();
  const customThemes = listCustomThemes();
  const themeId = resolveThemeId(shell, readSystemPrefersDark(), customThemes);
  applyLayoutToDocument(
    resolveInterfacePreferencesForSurface(UI_PREFERENCES, interfaceSize, surface)
  );
  applyThemeToDocument(themeId, customThemes);
  installKeyboardNavigationTracking();
}
