import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../../index.css";
import { getFrontendRoot, initializeDocumentPresentation } from "../../lib/frontendBootstrap.js";
import { DockHeaderApp } from "./DockHeaderApp.jsx";

const root = getFrontendRoot();
initializeDocumentPresentation("dock-header");
createRoot(root).render(
  <StrictMode>
    <DockHeaderApp />
  </StrictMode>
);
