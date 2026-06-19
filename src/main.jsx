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

const systemPrefersDark = readSystemPrefersDark();
const shell = readPersistedShellThemeFields(UI_PREFERENCES);
const resolvedThemeId = resolveThemeId(shell, systemPrefersDark);
applyLayoutToDocument(UI_PREFERENCES);
applyThemeToDocument(resolvedThemeId);

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
