// Captures the homepage feature images in a disposable Windows workbench: the 7.1.4 FILE
// workspace first, then the LIVE History and Frequency views. Publishes nothing; see
// export-homepage-features.mjs.
import process from "node:process";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { resolveRenderEndpointId, startPlayer, stopPlayer, locateVlc } from "../capture-rig.mjs";
import { ROOT, contained, sha256, verifyAudio } from "./hero-lib.mjs";
import {
  FEATURES_RECIPE,
  parseCaptureArgs,
  loadRecipeFile,
  validateFeaturesRecipe,
  assertSnapshotAt,
  multichannelAudioError,
} from "./homepage-lib.mjs";
import { openWorkbench } from "./workbench.mjs";

const options = parseCaptureArgs(process.argv.slice(2), FEATURES_RECIPE, ["--multichannel-audio"]);
const recipe = await loadRecipeFile(options.recipe, validateFeaturesRecipe);
if (process.platform !== recipe.environment.platform)
  throw new Error("This capture recipe requires Windows.");
const output = contained(
  join(ROOT, "artifacts/marketing"),
  options.out
    ? resolve(options.out)
    : join(ROOT, "artifacts/marketing", `homepage-features-${Date.now()}`)
);
await mkdir(dirname(output), { recursive: true });
await mkdir(output); // Exclusive: never reuse an old app profile or overwrite a capture run.
const controller = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => controller.abort());
const report = {
  version: 1,
  recipe,
  status: "running",
  captures: [],
  cleanup: {},
  startedAt: new Date().toISOString(),
};
const save = () =>
  writeFile(join(output, "capture-report.json"), JSON.stringify(report, null, 2) + "\n");
const wait = (ms) => delay(ms, undefined, { signal: controller.signal });
let workbench, player;
let liveStarted = false;
try {
  console.log(`Feature run: ${output}`);
  verifyAudio(await readFile(contained(ROOT, recipe.audio.path)), recipe);
  // The bed may stay in the production archive, outside the repository.
  const multichannelPath = options.multichannelAudio
    ? resolve(options.multichannelAudio)
    : contained(ROOT, recipe.multichannelAudio.path);
  const bed = await readFile(multichannelPath).catch((error) => {
    if (error.code === "ENOENT")
      throw multichannelAudioError(recipe.multichannelAudio, multichannelPath);
    throw error;
  });
  if (sha256(bed) !== recipe.multichannelAudio.sha256)
    throw multichannelAudioError(recipe.multichannelAudio, multichannelPath, sha256(bed));
  report.multichannelAudioPath = multichannelPath;
  locateVlc();
  const endpoint = resolveRenderEndpointId(recipe.live.renderEndpointName);
  workbench = await openWorkbench({ output, recipe, report, signal: controller.signal });
  const { call, mutate, patch, screenshot } = workbench;

  async function applyScene(scene) {
    await patch(["workspace", "apply"], scene.layout);
    for (const [panelId, controls] of Object.entries(scene.panels))
      await patch(["panel", "update", panelId], controls);
  }
  async function capture(image) {
    if (image.frequencyRangeHz)
      await patch(["axis", "shared", "update", "frequency"], image.frequencyRangeHz);
    if (image.snapshotOffsetSec !== undefined)
      await mutate([
        "transport",
        "snapshot",
        "select",
        "--offset-sec",
        String(image.snapshotOffsetSec),
      ]);
    await wait(1000);
    if (image.snapshotOffsetSec !== undefined)
      assertSnapshotAt((await call(["inspect"])).transport, image.snapshotOffsetSec);
    const record = await screenshot(image.name, image);
    report.captures.push({ name: image.name, ...record });
    await save();
  }
  async function analysisSettled(timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const transport = await call(["transport", "inspect"]);
      const active = transport.files.sessions.find((s) => s.id === transport.files.activeId);
      if (!transport.files.analyzingId && ["complete", "error"].includes(active?.state))
        return transport;
      if (Date.now() > deadline) throw new Error("File analysis timed out.");
      await wait(1000);
    }
  }

  // 7.1.4 FILE workspace with the saved delivery Profile. Channel labels need an analyzed
  // source, and the reanalysis applies them and the Profile to the measured session.
  const audio = recipe.multichannelAudio;
  await mutate(["transport", "file", "analyze", multichannelPath]);
  await analysisSettled(240000);
  await patch(["settings", "update"], {
    interfaceSize: recipe.interfaceSize,
    channelLabels: {
      channelCount: audio.channelRoles.length,
      mode: "custom",
      roles: audio.channelRoles,
    },
  });
  await applyScene(recipe.multichannel.scene);
  report.loudnessProfile = await patch(
    ["loudness-profile", "create"],
    recipe.multichannel.loudnessProfile
  );
  await mutate([
    "transport",
    "file",
    "reanalyze",
    (await call(["transport", "inspect"])).files.activeId,
  ]);
  const transport = await analysisSettled(240000);
  const session = transport.files.sessions.find((s) => s.id === transport.files.activeId);
  report.multichannelSummary = session?.summary;
  if (session?.state !== "complete" || session.summary.loudnessLayout !== audio.loudnessLayout)
    throw new Error(
      `Expected a complete ${audio.loudnessLayout} analysis: ${JSON.stringify(session)}`
    );
  for (const image of recipe.multichannel.images) await capture(image);

  // LIVE History and Frequency views from the Default preset.
  const live = recipe.live;
  const preset = (await call(["preset", "list"])).presets.find((p) => p.name === live.presetName);
  if (!preset) throw new Error(`No ${live.presetName} preset.`);
  await mutate(["preset", "apply", preset.id]);
  await patch(["settings", "update"], { interfaceSize: recipe.interfaceSize });
  await applyScene(live.scenes[0]);
  await workbench.selectInput(live.inputLabel);
  await mutate(["transport", "source", "live"]);
  await mutate(["transport", "live", "clear"]);
  await mutate(["transport", "live", "start"]);
  liveStarted = true;
  player = await startPlayer(endpoint, contained(ROOT, recipe.audio.path), { wait: options.wait });
  const started = Date.now();
  const signalPath = join(output, "signal-present.json");
  await writeFile(signalPath, JSON.stringify({ kind: "signalPresent" }));
  report.firstSignal = await call([
    "measurement",
    "wait-until",
    signalPath,
    "--timeout-ms",
    "10000",
  ]);
  if (report.firstSignal.outcome !== "condition")
    throw new Error("No LIVE signal arrived within 10 seconds.");
  console.log("LIVE signal verified. Filling the history.");
  await wait(Math.max(0, started + live.historySeconds * 1000 - Date.now()));
  if (player.exitCode !== null) throw new Error("Audio player exited before capture completed.");
  report.measurement = await call(["measurement", "inspect"]);
  if (!Number.isFinite(report.measurement.loudness?.integratedLufs))
    throw new Error("No measured audio.");
  for (const [index, scene] of live.scenes.entries()) {
    if (index > 0) await applyScene(scene);
    for (const image of scene.images) await capture(image);
  }
  report.status = "reviewRequired";
  report.manualReview =
    "Compare each PNG with the published original under the recipe's raw directory before export.";
} catch (error) {
  report.status = "failed";
  report.error = error.message;
  process.exitCode = 1;
  console.error(error.message);
} finally {
  try {
    stopPlayer(player);
    report.cleanup.playerStopped = true;
  } catch (error) {
    report.cleanup.playerStopError = error.message;
  }
  if (liveStarted) {
    try {
      await workbench.mutate(["transport", "live", "stop"]);
    } catch (error) {
      report.cleanup.captureStopError = error.message;
    }
  }
  if (workbench) Object.assign(report.cleanup, await workbench.close());
  if (Object.keys(report.cleanup).some((k) => k.endsWith("Error"))) {
    report.status = "failed";
    process.exitCode = 1;
  }
  report.finishedAt = new Date().toISOString();
  await save();
  console.log(`Result: ${report.status}. ${join(output, "capture-report.json")}`);
}
