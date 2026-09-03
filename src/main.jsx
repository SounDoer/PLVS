import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import {
  UI_PREFERENCES,
  applyLayoutToDocument,
  applyThemeToDocument,
  readPersistedInterfaceSize,
  readPersistedShellThemeFields,
  readSystemPrefersDark,
  resolveThemeId,
  resolveInterfacePreferencesForSurface,
} from "./uiPreferences";
import { listCustomThemes } from "./theme/customThemesRepo.js";
import { DockHeaderApp } from "./dock/accessories/DockHeaderApp.jsx";
import { DockEditorApp } from "./dock/accessories/DockEditorApp.jsx";
import { applyDocumentSurface } from "./dock/accessories/documentSurface.js";
import { DOCK_ACCESSORY_SURFACES } from "./dock/accessoryProtocol.js";
import { migrateDialogueVadEngine } from "./persistence/migrateDialogueVadEngine.js";

const surface = applyDocumentSurface(window.location.search);

// Main surface only: the dock accessories are separate webviews over the same storage and have no
// Stats panels to read from. Must run before `createRoot`, since the first workspace write-back
// normalizes the old panel-control key away.
if (!DOCK_ACCESSORY_SURFACES.includes(surface)) {
  migrateDialogueVadEngine();
}
const systemPrefersDark = readSystemPrefersDark();
const shell = readPersistedShellThemeFields();
const interfaceSize = readPersistedInterfaceSize();
const customThemes = listCustomThemes();
const resolvedThemeId = resolveThemeId(shell, systemPrefersDark, customThemes);
applyLayoutToDocument(
  resolveInterfacePreferencesForSurface(UI_PREFERENCES, interfaceSize, surface)
);
applyThemeToDocument(resolvedThemeId, customThemes);

const RootComponent =
  surface === "dock-header" ? DockHeaderApp : surface === "dock-editor" ? DockEditorApp : App;

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <RootComponent />
  </React.StrictMode>
);
