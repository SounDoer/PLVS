import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { DockHeaderApp } from "./dock/accessories/DockHeaderApp.jsx";
import { DockEditorApp } from "./dock/accessories/DockEditorApp.jsx";
import { DockImportApp } from "./dock/accessories/DockImportApp.jsx";
import { DockSettingsApp } from "./dock/accessories/DockSettingsApp.jsx";
import { applyDocumentSurface } from "./dock/accessories/documentSurface.js";
import { DOCK_ACCESSORY_SURFACES } from "./dock/accessoryProtocol.js";
import { migrateDialogueVadEngine } from "./persistence/migrateDialogueVadEngine.js";
import { AppCrashBoundary } from "./components/AppCrashBoundary.jsx";
import { getFrontendRoot, initializeDocumentPresentation } from "./lib/frontendBootstrap.js";

const container = getFrontendRoot();
const surface = applyDocumentSurface(window.location.search);

// Main surface only: the dock accessories are separate webviews over the same storage and have no
// Stats panels to read from. Must run before `createRoot`, since the first workspace write-back
// normalizes the old panel-control key away.
if (!DOCK_ACCESSORY_SURFACES.includes(surface)) {
  migrateDialogueVadEngine();
}
initializeDocumentPresentation(surface);

const root = ["dock-settings", "dock-authoring"].includes(surface) ? (
  <DockSettingsApp surface={surface} />
) : surface === "dock-header" ? (
  <DockHeaderApp />
) : surface === "dock-editor" ? (
  <DockEditorApp />
) : surface === "dock-import" ? (
  <DockImportApp />
) : (
  <AppCrashBoundary>
    <App />
  </AppCrashBoundary>
);

createRoot(container).render(<React.StrictMode>{root}</React.StrictMode>);
