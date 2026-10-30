// Homepage image renderer: the Sharesets preview harness driven by a plan, asset and scene that
// `scripts/marketing/render-homepage-images.mjs` builds in Node. Fixtures arrive inside the plan,
// so this entry is not part of the app build and never bundles them.
import React from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import "../index.css";
import { LoudnessProfileEditor } from "../components/LoudnessProfileEditor.jsx";
import { resolveInterfacePreferences } from "../preferences/interfaceSize.js";
import { SharesetsPreviewApp } from "../sharesets-preview/SharesetsPreviewApp.jsx";
import { installSharesetsPreviewIsolation } from "../sharesets-preview/isolation.js";
import { publishSharesetsPreviewTheme } from "../sharesets-preview/previewTheme.js";
import { settleSharesetsPreviewRender } from "../sharesets-preview/renderBarrier.js";
import { applyLayoutToDocument, applyThemeToDocument, UI_PREFERENCES } from "../uiPreferences.js";

const html = document.documentElement;
const noop = () => {};

/**
 * A surface the app opens over the workspace. Only the Loudness Profile editor is supported: it is
 * presentational, so a draft of the scene's Profile shows it exactly as the app's Edit does.
 * @param {{ overlay: { type: string, profile: any, pos: { x: number, y: number } } }} props
 */
function Overlay({ overlay }) {
  if (overlay.type !== "loudness-profile-editor") {
    throw new Error(`Unsupported homepage overlay: ${overlay.type}.`);
  }
  return (
    <LoudnessProfileEditor
      draft={{ editingId: overlay.profile.id, document: overlay.profile, dirty: false }}
      onEdit={noop}
      onSave={noop}
      onCancel={noop}
      pos={overlay.pos}
      onMove={noop}
    />
  );
}

let renderFailure = null;

function recordRenderFailure(error) {
  renderFailure = error instanceof Error ? error : new Error(String(error));
  html.dataset.homepagePreviewError = renderFailure.message;
}

const root = createRoot(document.getElementById("homepage-preview-root"), {
  onCaughtError: recordRenderFailure,
  onUncaughtError: recordRenderFailure,
});

/**
 * @param {{ plan: any, assetId: string, scene?: object, interfaceSize?: string, overlay?: any }} request
 */
async function render({ plan, assetId, scene = {}, interfaceSize = "default", overlay = null }) {
  html.dataset.homepagePreviewReady = "false";
  delete html.dataset.homepagePreviewError;
  renderFailure = null;
  const asset = plan?.assets?.find((candidate) => candidate.id === assetId);
  if (!asset) throw new Error(`Unknown preview asset: ${assetId}.`);
  // Interface Size scales the layout tokens before mount, as the app applies it at startup.
  applyLayoutToDocument(resolveInterfacePreferences(UI_PREFERENCES, interfaceSize));
  publishSharesetsPreviewTheme(plan, asset);
  flushSync(() =>
    root.render(
      <React.StrictMode>
        <div className="h-screen w-screen overflow-hidden">
          <SharesetsPreviewApp plan={plan} asset={asset} scene={scene} />
          {overlay ? <Overlay overlay={overlay} /> : null}
        </div>
      </React.StrictMode>
    )
  );
  const settlement = await settleSharesetsPreviewRender({
    document,
    requestFrame: requestAnimationFrame,
  });
  if (renderFailure) throw renderFailure;
  html.dataset.homepagePreviewReady = "true";
  return { assetId, ready: true, ...settlement };
}

installSharesetsPreviewIsolation(globalThis);
applyThemeToDocument("plvs-dark");
html.lang = "en";
html.style.colorScheme = "dark";
window.__PLVS_HOMEPAGE_PREVIEW__ = Object.freeze({ render });
