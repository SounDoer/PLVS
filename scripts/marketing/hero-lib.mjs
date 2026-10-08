import { readFile } from "node:fs/promises";
import { resolve, relative, isAbsolute, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { DEFAULT_WORKSPACE_STATE } from "../../src/workspace/constants.js";
import { serializeWorkspaceLayout } from "../../src/agentControl/workspaceLayout.js";
import { readPublicPanelControls } from "../../src/agentControl/panelControls.js";
import { createStarterProfile } from "../../src/lib/loudnessProfileCatalog.js";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const DEFAULT_RECIPE = "scripts/marketing/recipes/homepage-hero.json";
export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
export function contained(root, path) {
  const full = resolve(root, path);
  const rel = relative(root, full);
  if (!rel || rel.startsWith("..") || isAbsolute(rel))
    throw new Error(`Path escapes its directory: ${path}`);
  return full;
}
export function validateRecipe(recipe) {
  if (
    recipe.version !== 1 ||
    recipe.id !== "homepage-hero" ||
    recipe.capture?.source !== "live" ||
    recipe.scene?.layout !== "current-first-run-default" ||
    recipe.scene?.panelControls !== "current-first-run-default" ||
    recipe.scene?.loudnessProfile !== "current-starter-default" ||
    recipe.environment?.platform !== "win32"
  ) {
    throw new Error("Unsupported hero recipe; expected the Windows default LIVE scene.");
  }
  if (!/^[a-f0-9]{64}$/.test(recipe.audio?.sha256)) throw new Error("Audio checksum is required.");
  const c = recipe.capture;
  if (
    !Array.isArray(c.candidateSeconds) ||
    !c.candidateSeconds.length ||
    c.candidateSeconds.some(
      (n, i, a) =>
        !Number.isFinite(n) || n <= c.historySeconds || n >= 90 || (i > 0 && n <= a[i - 1])
    )
  ) {
    throw new Error("Capture times must increase, fill history, and precede the end of the audio.");
  }
  for (const key of ["width", "height", "windowDpi", "textScalePercent"]) {
    if (!Number.isInteger(recipe.environment[key]) || recipe.environment[key] <= 0)
      throw new Error(`Invalid ${key}`);
  }
  for (const path of [
    recipe.audio.path,
    recipe.audio.provenancePath,
    ...Object.values(recipe.publication),
  ])
    contained(ROOT, path);
  if (
    !c.requiredStatuses ||
    Object.keys(c.requiredStatuses).length === 0 ||
    Object.entries(c.requiredStatuses).some(
      ([key, value]) =>
        !["integrated", "shortTermMax", "truePeak"].includes(key) ||
        !["ok", "warn", "fail"].includes(value)
    )
  ) {
    throw new Error("Explicit supported threshold statuses are required.");
  }
  return recipe;
}
export async function loadRecipe(path = DEFAULT_RECIPE) {
  return validateRecipe(JSON.parse(await readFile(resolve(ROOT, path), "utf8")));
}
export function verifyAudio(bytes, recipe) {
  if (sha256(bytes) !== recipe.audio.sha256) throw new Error("Audio checksum mismatch.");
  if (
    bytes.toString("ascii", 0, 4) !== "RIFF" ||
    bytes.toString("ascii", 8, 16) !== "WAVEfmt " ||
    bytes.readUInt16LE(20) !== 1 ||
    bytes.readUInt16LE(22) !== 2 ||
    bytes.readUInt32LE(24) !== 48000 ||
    bytes.readUInt16LE(34) !== 24 ||
    bytes.length !== 44 + 90 * 48000 * 6
  ) {
    throw new Error("Expected the canonical 90-second stereo 48 kHz 24-bit WAV.");
  }
}
export function assertClearUi(ui) {
  if (
    !ui.window?.visible ||
    ui.window.form !== "normal" ||
    ui.surfaces?.length !== 0 ||
    ui.activeBlockingEditors?.length !== 0
  ) {
    throw new Error(
      "The normal visible workbench must have no open UI surfaces or blocking editors."
    );
  }
}
export function assertDefaultScene(state, profile, recipe) {
  const expected = DEFAULT_WORKSPACE_STATE;
  const starter = createStarterProfile(() => "ignored");
  if (!isDeepStrictEqual(state.workspace.layout, serializeWorkspaceLayout(expected)))
    throw new Error("Workspace is not the current default layout.");
  if (state.workspace.panels.length !== expected.panelOrder.length)
    throw new Error("Unexpected panel count.");
  for (const panel of state.workspace.panels) {
    if (
      !expected.panelsById[panel.id] ||
      panel.moduleId !== expected.panelsById[panel.id].moduleId ||
      !isDeepStrictEqual(
        panel.controls,
        readPublicPanelControls(panel.moduleId, expected.panelControlsById[panel.id], {
          hasLoudnessReference: true,
        })
      )
    ) {
      throw new Error(`Panel ${panel.id} is not using current first-run controls.`);
    }
    for (const [kind, axis] of Object.entries(panel.axes)) {
      const range =
        kind === "time"
          ? { offsetSec: 0, windowSec: recipe.capture.historySeconds }
          : { minHz: 20, maxHz: 20000 };
      if (!axis.linked || !isDeepStrictEqual(axis.range, range))
        throw new Error(`Unexpected ${kind} axis on ${panel.id}.`);
    }
  }
  if (
    profile.referenceLufs !== starter.referenceLufs ||
    !isDeepStrictEqual(profile.rules, starter.rules)
  )
    throw new Error("Loudness profile is not the current starter default.");
  if (
    state.appearance.resolvedThemeId !== recipe.scene.themeId ||
    state.settings.interfaceSize !== recipe.scene.interfaceSize ||
    state.dock.enabled ||
    !isDeepStrictEqual(state.view, {
      pinned: false,
      focusView: { autoHideControls: false, compactPanels: false, borderless: false },
      surfaceOpacity: 100,
      glassEnabled: false,
    })
  ) {
    throw new Error("Theme, interface size, Dock, or View does not match the recipe.");
  }
}
export function candidateIssues(measurement, recipe) {
  const issues = [];
  if (
    measurement.source?.kind !== "live" ||
    measurement.source.state !== "running" ||
    measurement.sample?.freshness !== "fresh"
  )
    issues.push("LIVE sample is not fresh and running");
  if (!(measurement.sample?.elapsedMs >= recipe.capture.historySeconds * 1000))
    issues.push("History is not full");
  if (
    !Number.isFinite(measurement.loudness?.integratedLufs) ||
    !measurement.levels?.channels?.some((c) => Number.isFinite(c.peakDbfs) && c.peakDbfs > -90)
  )
    issues.push("No measured audio");
  for (const [metric, status] of Object.entries(recipe.capture.requiredStatuses)) {
    if (measurement.profile?.byMetric?.[metric] !== status)
      issues.push(`${metric} must be ${status}`);
  }
  return issues;
}
export function assertGeometry(actual, expected) {
  for (const key of ["width", "height", "windowDpi", "textScalePercent"]) {
    if (actual[key] !== expected[key])
      throw new Error(`Capture ${key}: expected ${expected[key]}, got ${actual[key]}.`);
  }
}
