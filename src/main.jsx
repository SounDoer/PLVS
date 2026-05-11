import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { FloatApp, getFloatParamFromUrl } from "./FloatApp";
import "./index.css";
import {
  UI_PREFERENCES,
  applyUiPreferencesToDocument,
  readPersistedUiMode,
  readSystemPrefersDark,
  resolveEffectiveUiMode,
} from "./uiPreferences";

applyUiPreferencesToDocument(
  UI_PREFERENCES,
  resolveEffectiveUiMode(readPersistedUiMode(), readSystemPrefersDark()),
);

const float = getFloatParamFromUrl();

createRoot(document.getElementById("root")).render(
  <React.StrictMode>{float ? <FloatApp kind={float} /> : <App />}</React.StrictMode>
);
