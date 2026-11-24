import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../../index.css";
import { getFrontendRoot, initializeDocumentPresentation } from "../../lib/frontendBootstrap.js";
import { DockSettingsApp } from "./DockSettingsApp.jsx";

const root = getFrontendRoot();
const surface =
  new URLSearchParams(window.location.search).get("surface") === "dock-authoring"
    ? "dock-authoring"
    : "dock-settings";
document.documentElement.dataset.surface = surface;
initializeDocumentPresentation(surface);
createRoot(root).render(
  <StrictMode>
    <DockSettingsApp surface={surface} />
  </StrictMode>
);
