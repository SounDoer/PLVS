// Pure helpers for render-homepage-images.mjs: recipe validation, the Snapshot offset guard, the
// hero verdict check and the portable Preset pieces each scene needs.
import { loudnessProfileEvaluate } from "../../src/lib/loudnessProfileEvaluate.js";
import { DEFAULT_WORKSPACE_STATE } from "../../src/workspace/constants.js";
import { firstRunDockState } from "../../src/dock/firstRunDock.js";

export const SCENES = new Set(["workspace-shell", "workspace", "dock"]);
export const CROPS = new Set(["viewport", "rows", "panel", "rect"]);
export const OVERLAYS = new Set(["loudness-profile-editor"]);
export const INTERFACE_SIZES = new Set(["default", "large"]);

// Panels whose readings exist only for a fixture's final frame. A Snapshot anywhere else would
// show them with values from another moment, so such scenes must stay at offset 0.
export const FINAL_FRAME_MODULE_IDS = new Set([
  "levelMeter",
  "stats",
  "vectorscope",
  "correlation",
  "stereo-map",
]);

function layoutModuleIds(node) {
  if (!node) return [];
  if (node.type === "panel") return [node.panelId];
  return (node.children ?? []).flatMap(layoutModuleIds);
}

/** The workspace definition of an image, resolving a named shared workspace. */
export function imageWorkspace(recipe, image) {
  if (typeof image.workspace === "string") {
    const shared = recipe.workspaces?.[image.workspace];
    if (!shared) throw new Error(`${image.name}: unknown workspace "${image.workspace}".`);
    return shared;
  }
  return image.workspace;
}

/** Module ids an image shows. */
export function imageModuleIds(recipe, image) {
  if (image.scene === "workspace-shell") {
    return DEFAULT_WORKSPACE_STATE.panelOrder.map(
      (id) => DEFAULT_WORKSPACE_STATE.panelsById[id].moduleId
    );
  }
  if (image.scene === "dock") {
    if (image.dock === "first-run") {
      const { layout } = firstRunDockState();
      return layout.panelOrder.map((id) => layout.panelsById[id].moduleId);
    }
    return (image.dock?.panels ?? []).map(({ moduleId }) => moduleId);
  }
  return layoutModuleIds(imageWorkspace(recipe, image)?.layout);
}

/** Every problem with a recipe, as messages; an empty list means it is valid. */
export function homepageRecipeProblems(recipe) {
  const problems = [];
  const dsf = recipe?.deviceScaleFactor;
  if (!(dsf > 0)) problems.push("deviceScaleFactor must be positive.");
  const names = new Set();
  for (const image of recipe?.images ?? []) {
    const at = image?.name ?? "(unnamed image)";
    if (!image?.name) problems.push("Every image needs a name.");
    else if (names.has(image.name)) problems.push(`${at}: duplicate name.`);
    names.add(image?.name);
    if (!SCENES.has(image?.scene)) problems.push(`${at}: unknown scene ${image?.scene}.`);
    if (!recipe.fixtures?.[image?.fixture])
      problems.push(`${at}: unknown fixture ${image?.fixture}.`);
    if (!INTERFACE_SIZES.has(image?.interfaceSize ?? "default")) {
      problems.push(`${at}: unknown Interface Size ${image.interfaceSize}.`);
    }
    if (!CROPS.has(image?.crop?.type)) problems.push(`${at}: unknown crop ${image?.crop?.type}.`);
    const { width, height } = image?.output ?? {};
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)) {
      problems.push(`${at}: output size must be whole pixels.`);
    }
    if (image?.crop?.type === "viewport" && dsf > 0) {
      const scaled = [image.viewport?.width * dsf, image.viewport?.height * dsf];
      if (scaled[0] !== width || scaled[1] !== height) {
        problems.push(
          `${at}: viewport × ${dsf} is ${scaled.join(" × ")}, not ${width} × ${height}.`
        );
      }
    }
    if (image?.crop?.type === "rows" && image.crop.height !== height) {
      problems.push(`${at}: a rows crop must match the output height.`);
    }
    if (image?.crop?.type === "rect" && dsf > 0) {
      const { x, y, width: cropWidth, height: cropHeight } = image.crop;
      if (![x, y, cropWidth, cropHeight].every(Number.isFinite)) {
        problems.push(`${at}: a rect crop needs x, y, width and height in CSS px.`);
      } else if (cropWidth * dsf !== width || cropHeight * dsf !== height) {
        problems.push(
          `${at}: rect × ${dsf} is ${cropWidth * dsf} × ${cropHeight * dsf}, not ${width} × ${height}.`
        );
      } else if (x + cropWidth > image.viewport?.width || y + cropHeight > image.viewport?.height) {
        problems.push(`${at}: the rect crop leaves the viewport.`);
      }
    }
    if (image?.overlay && !OVERLAYS.has(image.overlay.type)) {
      problems.push(`${at}: unknown overlay ${image.overlay.type}.`);
    }
    if (image?.overlay?.type === "loudness-profile-editor" && !image.loudnessProfile) {
      problems.push(`${at}: the Loudness Profile editor needs the image's loudnessProfile.`);
    }
    if (
      typeof image?.loudnessProfile === "string" &&
      !recipe.loudnessProfiles?.[image.loudnessProfile]
    ) {
      problems.push(`${at}: unknown loudnessProfile "${image.loudnessProfile}".`);
    }
    if (image?.shell && image.scene !== "workspace") {
      problems.push(`${at}: only a workspace scene takes shell.`);
    }
    if (image?.crop?.type === "panel" && !image.crop.moduleId) {
      problems.push(`${at}: a panel crop names its moduleId.`);
    }
    const offset = image?.snapshotOffsetSec;
    if (offset !== undefined && !(Number.isFinite(offset) && offset >= 0)) {
      problems.push(`${at}: snapshotOffsetSec must be a non-negative number.`);
    }
    if (offset > 0 && SCENES.has(image?.scene)) {
      let modules = [];
      try {
        modules = imageModuleIds(recipe, image);
      } catch (error) {
        problems.push(error.message);
      }
      const finalOnly = modules.filter((id) => FINAL_FRAME_MODULE_IDS.has(id));
      if (finalOnly.length > 0) {
        problems.push(
          `${at}: a Snapshot ${offset} s back cannot show ${finalOnly.join(", ")}; their readings exist only for the final frame.`
        );
      }
    }
    if (image?.scene === "workspace") {
      try {
        if (!imageWorkspace(recipe, image)?.layout)
          problems.push(`${at}: workspace has no layout.`);
      } catch (error) {
        problems.push(error.message);
      }
    }
  }
  return problems;
}

/** Profile statuses of a fixture's final frame, as the Stats panel colours them. */
export function finalFrameStatuses(fixture, profile) {
  const { loudness } = fixture.measurementFrame;
  return loudnessProfileEvaluate(profile, {
    values: {
      momentary: loudness.momentaryLufs,
      shortTerm: loudness.shortTermLufs,
      integrated: loudness.integratedLufs,
      lra: loudness.rangeLu,
      truePeak: loudness.truePeakDbtp,
    },
    integratedReady: true,
  });
}

/** Messages for each required status the fixture does not produce. */
export function statusMismatches(actual, required = {}) {
  return Object.entries(required)
    .filter(([metric, status]) => actual[metric] !== status)
    .map(([metric, status]) => `${metric} reads ${actual[metric] ?? "unwatched"}, not ${status}`);
}

/**
 * A recipe workspace as a portable Preset workspace: panel nodes become keyed panels carrying
 * their controls and axes.
 */
export function portableWorkspace({ layout, panels = {}, axes = {} }) {
  const portablePanels = [];
  const walk = (node) => {
    if (node.type === "panel") {
      const key = `panel-${node.panelId}`;
      portablePanels.push({
        key,
        moduleId: node.panelId,
        controls: panels[node.panelId] ?? {},
        axes: axes[node.panelId] ?? {},
      });
      return { type: "panel", key };
    }
    return { ...node, children: node.children.map(walk) };
  };
  return { layout: walk(layout), panels: portablePanels };
}

/** Portable Dock panels from recipe panels, starting from first-run controls where asked. */
export function portableDockPanels(panels, firstRunControlsByModuleId) {
  return panels.map((panel, index) => ({
    key: `dock-${index + 1}`,
    moduleId: panel.moduleId,
    ...(panel.title ? { title: panel.title } : {}),
    preferredWidthCssPx: panel.width,
    controls: {
      ...(panel.firstRunControls ? firstRunControlsByModuleId[panel.moduleId] : {}),
      ...panel.controls,
    },
  }));
}
