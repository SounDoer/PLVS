import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { FloatApp, getFloatParamFromUrl } from "./FloatApp";
import "./index.css";
import {
  UI_PREFERENCES,
  applyLayoutToDocument,
  applyThemeToDocument,
  readPersistedShellThemeFields,
  readSystemPrefersDark,
  resolveThemeId,
} from "./uiPreferences";
import { getBuiltinTheme } from "./theme/builtinThemes.js";

const systemPrefersDark = readSystemPrefersDark();
const shell = readPersistedShellThemeFields(UI_PREFERENCES);
const resolvedThemeId = resolveThemeId(shell, systemPrefersDark);
const resolvedTheme = getBuiltinTheme(resolvedThemeId);
applyLayoutToDocument(UI_PREFERENCES, { colorScheme: resolvedTheme.colorScheme });
applyThemeToDocument(resolvedThemeId);

const float = getFloatParamFromUrl();

createRoot(document.getElementById("root")).render(
  <React.StrictMode>{float ? <FloatApp kind={float} /> : <App />}</React.StrictMode>
);
