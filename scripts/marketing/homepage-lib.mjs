// Pure helpers for the homepage Dock and feature-image captures. No process, file or app access
// beyond reading a recipe, so the safeguards can be tested without the capture rig.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ROOT, contained } from "./hero-lib.mjs";

export const DOCK_RECIPE = "scripts/marketing/recipes/homepage-dock.json";
export const FEATURES_RECIPE = "scripts/marketing/recipes/homepage-features.json";
const SHA256 = /^[a-f0-9]{64}$/;

/** `[--recipe <file>] [--out <dir>] [--wait]` for the capture commands. */
export function parseCaptureArgs(argv, defaultRecipe) {
  const options = { recipe: defaultRecipe, out: null, wait: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--wait") options.wait = true;
    else if (
      (arg === "--recipe" || arg === "--out") &&
      argv[i + 1] &&
      !argv[i + 1].startsWith("--")
    )
      options[arg.slice(2)] = argv[++i];
    else throw new Error(`Usage: [--recipe <file>] [--out <run-directory>] [--wait]; got ${arg}`);
  }
  return options;
}

/** `<run-directory> --reviewed [--publish]` for the export commands. */
export function parseExportArgs(argv) {
  const [run, ...flags] = argv;
  if (
    !run ||
    run.startsWith("--") ||
    !flags.includes("--reviewed") ||
    flags.some((f) => !["--reviewed", "--publish"].includes(f))
  )
    throw new Error("Usage: <run-directory> --reviewed [--publish]");
  return { run, publish: flags.includes("--publish") };
}

/** The default strip shows LIVE metering: no Snapshot, and following the live edge. */
export function assertLiveEdge(transport) {
  if (
    transport?.snapshot?.active ||
    transport?.live?.state !== "running" ||
    transport.live.atLiveEdge !== true
  )
    throw new Error(
      `Default Dock must be captured LIVE at the live edge: ${JSON.stringify({ live: transport?.live, snapshot: transport?.snapshot })}`
    );
}

/** The custom strip is a Snapshot at the requested offset. */
export function assertSnapshotAt(transport, offsetSec) {
  if (!transport?.snapshot?.active || transport.snapshot.offsetSec !== offsetSec)
    throw new Error(
      `Expected a Snapshot at ${offsetSec}s: ${JSON.stringify(transport?.snapshot ?? null)}`
    );
}

export function findStartupSurface(ui, spec) {
  return ui.surfaces?.find(
    (s) =>
      s.kind === spec.kind &&
      s.target?.phase === spec.phase &&
      (s.supportedActions ?? []).includes(spec.action)
  );
}

function validateAudio(audio, label) {
  if (!audio?.path || !SHA256.test(audio.sha256))
    throw new Error(`${label} needs a path and SHA-256.`);
  contained(ROOT, audio.path);
}

function validateCommon(recipe, id) {
  if (recipe?.version !== 1 || recipe.id !== id || recipe.environment?.platform !== "win32")
    throw new Error(`Unsupported recipe; expected Windows ${id} version 1.`);
  validateAudio(recipe.audio, "LIVE audio");
  for (const key of ["windowDpi", "textScalePercent"])
    if (!Number.isInteger(recipe.environment[key]) || recipe.environment[key] <= 0)
      throw new Error(`Invalid ${key}`);
  const startup = recipe.startup;
  if (
    !startup?.themeId ||
    !Array.isArray(startup.dismissSurfaces) ||
    startup.dismissSurfaces.some((s) => !s.kind || !s.phase || s.action !== "cancel") ||
    !Number.isInteger(startup.surfaceTimeoutMs) ||
    startup.surfaceTimeoutMs <= 0
  )
    throw new Error("Startup must name a theme and the first-run surfaces to cancel.");
}

function validateLive(live) {
  if (
    live?.source !== "live" ||
    !live.inputLabel ||
    !live.renderEndpointName ||
    !Number.isFinite(live.historySeconds) ||
    live.historySeconds <= 0 ||
    live.historySeconds >= 90
  )
    throw new Error(
      "LIVE capture needs its input, render endpoint and a history inside the audio."
    );
}

function validateImage(image) {
  if (
    !/^[a-z][a-z0-9-]*$/.test(image?.name ?? "") ||
    !["workspace", "panel", "main"].includes(image.target) ||
    (image.target === "panel") !== Boolean(image.panelId) ||
    !Number.isInteger(image.width) ||
    !Number.isInteger(image.height) ||
    image.width <= 0 ||
    image.height <= 0
  )
    throw new Error(`Invalid image ${JSON.stringify(image?.name)}`);
  if (image.snapshotOffsetSec !== undefined && !(image.snapshotOffsetSec >= 0))
    throw new Error(`Invalid Snapshot offset for ${image.name}`);
}

function validateScene(scene, images = scene?.images) {
  if (scene?.layout?.type !== "split" && scene?.layout?.type !== "panel")
    throw new Error("Scene needs a workspace layout.");
  const ids = [];
  (function collect(node) {
    if (node.type === "panel") ids.push(node.panelId);
    else node.children.forEach(collect);
  })(scene.layout);
  const configured = Object.keys(scene.panels ?? {});
  if (ids.length !== configured.length || ids.some((id) => !configured.includes(id)))
    throw new Error(`Scene controls must match its layout panels: ${ids.join(", ")}`);
  if (!images?.length) throw new Error("Scene captures no image.");
  images.forEach(validateImage);
}

export function validateDockRecipe(recipe) {
  validateCommon(recipe, "homepage-dock");
  const { capture, environment } = recipe;
  validateLive(capture);
  for (const key of ["width", "height"])
    if (!Number.isInteger(environment[key]) || environment[key] <= 0)
      throw new Error(`Invalid ${key}`);
  if (
    !["top", "bottom"].includes(capture.dock?.edge) ||
    typeof capture.dock.reserveSpace !== "boolean" ||
    !Number.isInteger(capture.dock.height) ||
    Math.round((capture.dock.height * environment.windowDpi) / 96) !== environment.height
  )
    throw new Error("Dock height at the recipe DPI must produce the recipe image height.");
  const [live, custom] = recipe.strips ?? [];
  if (
    recipe.strips?.length !== 2 ||
    live.name !== "dock-default" ||
    live.transport !== "live-edge" ||
    live.layout !== "current-first-run-default" ||
    custom.name !== "dock-custom" ||
    custom.transport !== "snapshot" ||
    custom.snapshotOffsetSec !== 0 ||
    !custom.layout?.panels?.length ||
    custom.layout.panels.some((p) => !(p.panelId || (p.key && p.moduleId)) || !(p.width > 0))
  )
    throw new Error(
      "Expected the default strip at the LIVE edge, then the custom layout as a Snapshot at 0 s."
    );
  for (const strip of recipe.strips) {
    const target = recipe.publication?.[strip.name];
    if (!target?.webp || !target.png || !target.metadata)
      throw new Error(`Publication targets missing for ${strip.name}`);
    Object.values(target).forEach((path) => contained(ROOT, path));
  }
  contained(ROOT, recipe.publication.html);
  if (!recipe.review?.url || !recipe.review.viewports?.includes(recipe.review.scrollViewport))
    throw new Error("Review needs a URL and viewports including the scroll check.");
  return recipe;
}

export function validateFeaturesRecipe(recipe) {
  validateCommon(recipe, "homepage-features");
  const multi = recipe.multichannelAudio;
  validateAudio(multi, "Multichannel audio");
  if (!multi.loudnessLayout || multi.channelRoles?.length < 3)
    throw new Error("Multichannel audio needs its channel roles and expected layout.");
  if (!recipe.interfaceSize) throw new Error("Interface size is required.");
  if (recipe.multichannel?.source !== "file") throw new Error("Multichannel images use FILE mode.");
  const profile = recipe.multichannel.loudnessProfile;
  if (!profile?.name || !Number.isFinite(profile.referenceLufs) || !profile.rules?.length)
    throw new Error("Multichannel scene needs its Loudness Profile.");
  validateScene(recipe.multichannel.scene, recipe.multichannel.images);
  validateLive(recipe.live);
  if (!recipe.live.presetName || !recipe.live.scenes?.length)
    throw new Error("LIVE images need a starting preset and scenes.");
  recipe.live.scenes.forEach((scene) => validateScene(scene));
  const names = [...recipe.multichannel.images, ...recipe.live.scenes.flatMap((s) => s.images)].map(
    (i) => i.name
  );
  if (new Set(names).size !== names.length) throw new Error("Image names must be unique.");
  contained(ROOT, recipe.publication?.rawDirectory ?? "");
  return recipe;
}

export async function loadRecipeFile(path, validate) {
  return validate(JSON.parse(await readFile(resolve(ROOT, path), "utf8")));
}
