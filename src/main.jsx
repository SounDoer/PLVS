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

const systemPrefersDark = readSystemPrefersDark();
const shell = readPersistedShellThemeFields(UI_PREFERENCES);
const customThemes = listCustomThemes();
const resolvedThemeId = resolveThemeId(shell, systemPrefersDark, customThemes);
applyLayoutToDocument(UI_PREFERENCES);
applyThemeToDocument(resolvedThemeId, customThemes);

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
