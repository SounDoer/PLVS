// Captures the homepage Dock pair in a disposable Windows workbench: the default strip LIVE at
// the live edge, then the custom layout as a Snapshot. Publishes nothing; see export-dock-pair.mjs.
import process from "node:process";
import { readFile, mkdir, writeFile, copyFile } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { resolveRenderEndpointId, startPlayer, stopPlayer, locateVlc } from "../capture-rig.mjs";
import { ROOT, contained, sha256, verifyAudio } from "./hero-lib.mjs";
import {
  DOCK_RECIPE,
  parseCaptureArgs,
  loadRecipeFile,
  validateDockRecipe,
  assertLiveEdge,
  assertSnapshotAt,
} from "./homepage-lib.mjs";
import { openWorkbench } from "./workbench.mjs";

const options = parseCaptureArgs(process.argv.slice(2), DOCK_RECIPE);
const recipe = await loadRecipeFile(options.recipe, validateDockRecipe);
if (process.platform !== recipe.environment.platform)
  throw new Error("This capture recipe requires Windows.");
const output = contained(
  join(ROOT, "artifacts/marketing"),
  options.out
    ? resolve(options.out)
    : join(ROOT, "artifacts/marketing", `homepage-dock-${Date.now()}`)
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
  baselineSha256: {},
  cleanup: {},
  startedAt: new Date().toISOString(),
};
const save = () =>
  writeFile(join(output, "capture-report.json"), JSON.stringify(report, null, 2) + "\n");
const [live, custom] = recipe.strips;
const size = { width: recipe.environment.width, height: recipe.environment.height };
let workbench, player;
let liveStarted = false;
let docked = false;
try {
  console.log(`Dock run: ${output}`);
  verifyAudio(await readFile(contained(ROOT, recipe.audio.path)), recipe);
  locateVlc();
  const endpoint = resolveRenderEndpointId(recipe.capture.renderEndpointName);
  for (const strip of recipe.strips) {
    const previous = join(output, `previous-${strip.name}.webp`);
    await copyFile(contained(ROOT, recipe.publication[strip.name].webp), previous);
    report.baselineSha256[strip.name] = sha256(await readFile(previous));
  }
  workbench = await openWorkbench({ output, recipe, report, signal: controller.signal });
  const { call, mutate, patch, screenshot } = workbench;
  report.dockBefore = await call(["dock", "inspect"]);
  await workbench.selectInput(recipe.capture.inputLabel);
  await mutate(["transport", "source", "live"]);
  await mutate(["transport", "live", "clear"]);
  await mutate(["transport", "live", "start"]);
  liveStarted = true;
  const dock = recipe.capture.dock;
  await mutate([
    "dock",
    "enter",
    "--edge",
    dock.edge,
    "--reserve-space",
    String(dock.reserveSpace),
    "--height",
    String(dock.height),
  ]);
  docked = true;
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
  console.log("LIVE signal verified. Filling the Dock history.");
  await delay(Math.max(0, started + recipe.capture.historySeconds * 1000 - Date.now()), undefined, {
    signal: controller.signal,
  });
  if (player.exitCode !== null) throw new Error("Audio player exited before capture completed.");
  report.measurement = await call(["measurement", "inspect"]);
  if (!Number.isFinite(report.measurement.loudness?.integratedLufs))
    throw new Error("No measured audio.");
  assertLiveEdge((await call(["inspect"])).transport);
  const liveImage = await screenshot(live.name, { target: "main", ...size });
  assertLiveEdge((await call(["inspect"])).transport);
  report.captures.push({ name: live.name, transport: live.transport, ...liveImage });
  await save();
  await mutate([
    "transport",
    "snapshot",
    "select",
    "--offset-sec",
    String(custom.snapshotOffsetSec),
  ]);
  await delay(800, undefined, { signal: controller.signal });
  assertSnapshotAt((await call(["inspect"])).transport, custom.snapshotOffsetSec);
  await patch(["dock", "layout", "apply"], custom.layout, "dock-custom-layout.json");
  await delay(1200, undefined, { signal: controller.signal });
  const customImage = await screenshot(custom.name, { target: "main", ...size });
  assertSnapshotAt(customImage.state.transport, custom.snapshotOffsetSec);
  report.captures.push({ name: custom.name, transport: custom.transport, ...customImage });
  const figures = recipe.strips
    .map(
      (s) =>
        `<section><h2>${s.name}</h2><figure><figcaption>Published</figcaption><img src="previous-${s.name}.webp"></figure><figure><figcaption>This run</figcaption><img src="${s.name}.png"></figure></section>`
    )
    .join("\n");
  await writeFile(
    join(output, "comparison.html"),
    `<!doctype html><meta charset="utf-8"><title>Homepage Dock review</title><style>body{background:#171717;color:#eee;font:16px system-ui;margin:24px}figure{margin:0 0 16px}img{width:100%}figcaption{margin:8px 0}</style><h1>Homepage Dock review</h1><p>Inspect curves, text, clipping and panel titles. No image has been published.</p>${figures}`
  );
  report.status = "reviewRequired";
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
  for (const [done, args, key] of [
    [docked, ["dock", "exit"], "dockExit"],
    [liveStarted, ["transport", "live", "stop"], "captureStop"],
  ]) {
    if (!done) continue;
    try {
      await workbench.mutate(args);
    } catch (error) {
      report.cleanup[`${key}Error`] = error.message;
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
