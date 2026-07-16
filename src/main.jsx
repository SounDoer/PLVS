import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import {
  UI_PREFERENCES,
  applyLayoutToDocument,
  applyThemeToDocument,
  readPersistedShellThemeFields,
  readSystemPrefersDark,
  resolveThemeId,
} from "./uiPreferences";
import { listCustomThemes } from "./theme/customThemesRepo.js";
import { DockHeaderApp } from "./dock/accessories/DockHeaderApp.jsx";
import { DockEditorApp } from "./dock/accessories/DockEditorApp.jsx";
import { applyDocumentSurface } from "./dock/accessories/documentSurface.js";

const systemPrefersDark = readSystemPrefersDark();
const shell = readPersistedShellThemeFields();
const customThemes = listCustomThemes();
const resolvedThemeId = resolveThemeId(shell, systemPrefersDark, customThemes);
applyLayoutToDocument(UI_PREFERENCES);
applyThemeToDocument(resolvedThemeId, customThemes);

const surface = applyDocumentSurface(window.location.search);
const RootComponent =
  surface === "dock-header" ? DockHeaderApp : surface === "dock-editor" ? DockEditorApp : App;

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <RootComponent />
  </React.StrictMode>
);
