import React from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import "../index.css";
import { applyLayoutToDocument, applyThemeToDocument, UI_PREFERENCES } from "../uiPreferences.js";
import { SharesetsPreviewApp } from "./SharesetsPreviewApp.jsx";
import { buildSharesetsPreviewPlan } from "../transfer/sharesetsPreview.js";
import { validatePublishablePack } from "../transfer/sharesetsPack.js";
import { buildSharesetsThemePreviewPlan } from "../theme/sharesetsThemePreview.js";
import { installSharesetsPreviewIsolation } from "./isolation.js";
import { publishSharesetsPreviewTheme } from "./previewTheme.js";
import { settleSharesetsPreviewRender } from "./renderBarrier.js";

const html = document.documentElement;
let renderFailure = null;

function recordRenderFailure(error) {
  renderFailure = error instanceof Error ? error : new Error(String(error));
  html.dataset.sharesetsPreviewError = renderFailure.message;
}

const rootElement = document.getElementById("sharesets-preview-root");
const root = createRoot(rootElement, {
  onCaughtError: recordRenderFailure,
  onUncaughtError: recordRenderFailure,
});

async function render(plan, assetId) {
  html.dataset.sharesetsPreviewReady = "false";
  delete html.dataset.sharesetsPreviewError;
  delete html.dataset.sharesetsPreviewAsset;
  renderFailure = null;
  const asset = plan?.assets?.find((candidate) => candidate.id === assetId);
  if (!asset) throw new Error(`Unknown Sharesets preview asset: ${assetId}.`);
  html.dataset.sharesetsPreviewAsset = asset.id;
  publishSharesetsPreviewTheme(plan, asset);
  // Mounted synchronously, so the render barrier never samples a scene that is not there yet.
  flushSync(() =>
    root.render(
      <React.StrictMode>
        <div
          key={`${plan.item?.contentHash ?? plan.theme?.contentHash}:${asset.id}`}
          data-sharesets-preview-asset={asset.id}
          className="h-screen w-screen overflow-hidden"
        >
          <SharesetsPreviewApp plan={plan} asset={asset} />
        </div>
      </React.StrictMode>
    )
  );
  try {
    const settlement = await settleSharesetsPreviewRender({
      document,
      requestFrame: requestAnimationFrame,
    });
    if (renderFailure) throw renderFailure;
    html.dataset.sharesetsPreviewReady = "true";
    return { assetId: asset.id, ready: true, ...settlement };
  } catch (error) {
    html.dataset.sharesetsPreviewError = error instanceof Error ? error.message : String(error);
    throw error;
  }
}

/**
 * @param {string} type
 * @param {string} assetId
 */
async function renderPack(rawPack, type, assetId) {
  const plan =
    type === "themes"
      ? await buildSharesetsThemePreviewPlan({
          theme: validatePublishablePack(rawPack, "themes").portableItem,
        })
      : await buildSharesetsPreviewPlan(rawPack, type);
  return render(plan, assetId);
}

async function renderLocationRequest() {
  const search = new URLSearchParams(window.location.search);
  const encoded = search.get("pack");
  if (!encoded) return;
  try {
    const base64 = encoded.replaceAll("-", "+").replaceAll("_", "/");
    const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    const json = new TextDecoder().decode(bytes);
    await renderPack(JSON.parse(json), search.get("type"), search.get("asset"));
  } catch (error) {
    html.dataset.sharesetsPreviewError = error instanceof Error ? error.message : String(error);
    throw error;
  }
}

installSharesetsPreviewIsolation(globalThis);
applyLayoutToDocument(UI_PREFERENCES);
applyThemeToDocument("plvs-dark");
html.lang = "en";
html.style.colorScheme = "dark";
window.__PLVS_SHARESETS_PREVIEW__ = Object.freeze({ render, renderPack });
void renderLocationRequest();
