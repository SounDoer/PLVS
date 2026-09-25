import React from "react";
import { createRoot } from "react-dom/client";
import "../index.css";
import { applyLayoutToDocument, applyThemeToDocument, UI_PREFERENCES } from "../uiPreferences.js";
import { CommunityPreviewApp } from "./CommunityPreviewApp.jsx";
import { buildCommunityPreviewPlan } from "../transfer/communityPreview.js";
import { validatePublishablePack } from "../transfer/communityPack.js";
import { buildCommunityThemePreviewPlan } from "../theme/communityThemePreview.js";
import { installCommunityPreviewIsolation } from "./isolation.js";
import { settleCommunityPreviewRender } from "./renderBarrier.js";

const html = document.documentElement;
let renderFailure = null;

function recordRenderFailure(error) {
  renderFailure = error instanceof Error ? error : new Error(String(error));
  html.dataset.communityPreviewError = renderFailure.message;
}

const rootElement = document.getElementById("community-preview-root");
const root = createRoot(rootElement, {
  onCaughtError: recordRenderFailure,
  onUncaughtError: recordRenderFailure,
});

async function render(plan, assetId) {
  html.dataset.communityPreviewReady = "false";
  delete html.dataset.communityPreviewError;
  delete html.dataset.communityPreviewAsset;
  renderFailure = null;
  const asset = plan?.assets?.find((candidate) => candidate.id === assetId);
  if (!asset) throw new Error(`Unknown Community preview asset: ${assetId}.`);
  html.dataset.communityPreviewAsset = asset.id;
  root.render(
    <React.StrictMode>
      <div
        key={`${plan.item?.contentHash ?? plan.theme?.contentHash}:${asset.id}`}
        data-community-preview-asset={asset.id}
        className="h-screen w-screen overflow-hidden"
      >
        <CommunityPreviewApp plan={plan} asset={asset} />
      </div>
    </React.StrictMode>
  );
  try {
    const settlement = await settleCommunityPreviewRender({
      document,
      requestFrame: requestAnimationFrame,
    });
    if (renderFailure) throw renderFailure;
    html.dataset.communityPreviewReady = "true";
    return { assetId: asset.id, ready: true, ...settlement };
  } catch (error) {
    html.dataset.communityPreviewError = error instanceof Error ? error.message : String(error);
    throw error;
  }
}

async function renderPack(rawPack, type, assetId) {
  const plan =
    type === "themes"
      ? await buildCommunityThemePreviewPlan({
          theme: validatePublishablePack(rawPack, "themes").portableItem,
        })
      : await buildCommunityPreviewPlan(rawPack, type);
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
    html.dataset.communityPreviewError = error instanceof Error ? error.message : String(error);
    throw error;
  }
}

installCommunityPreviewIsolation(globalThis);
applyLayoutToDocument(UI_PREFERENCES);
applyThemeToDocument("plvs-dark");
html.lang = "en";
html.style.colorScheme = "dark";
window.__PLVS_COMMUNITY_PREVIEW__ = Object.freeze({ render, renderPack });
void renderLocationRequest();
