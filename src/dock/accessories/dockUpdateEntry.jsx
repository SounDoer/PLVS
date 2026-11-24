import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../../index.css";
import { getFrontendRoot, initializeDocumentPresentation } from "../../lib/frontendBootstrap.js";
import { DockUpdateApp } from "./DockUpdateApp.jsx";

const root = getFrontendRoot();
initializeDocumentPresentation("dock-update");
createRoot(root).render(
  <StrictMode>
    <DockUpdateApp />
  </StrictMode>
);
