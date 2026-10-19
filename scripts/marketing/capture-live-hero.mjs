// Windows-only, disposable workbench. Never attaches to a user's running instance.
import process from "node:process";
import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import { readFile, mkdir, writeFile, copyFile } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import sharp from "sharp";
import { resolveRenderEndpointId, startPlayer, stopPlayer, locateVlc } from "../capture-rig.mjs";
import {
  ROOT,
  DEFAULT_RECIPE,
  loadRecipe,
  contained,
  sha256,
  verifyAudio,
  assertClearUi,
  assertDefaultScene,
  assertGeometry,
  candidateIssues,
} from "./hero-lib.mjs";
import { openWorkbench } from "./workbench.mjs";

const recipe = await loadRecipe(process.argv[2] ?? DEFAULT_RECIPE);
if (process.platform !== recipe.environment.platform)
  throw new Error("This capture recipe requires Windows.");
const output = contained(
  join(ROOT, "artifacts/marketing"),
  process.argv[3]
    ? resolve(process.argv[3])
    : join(ROOT, "artifacts/marketing", `homepage-hero-${Date.now()}`)
);
await mkdir(dirname(output), { recursive: true });
await mkdir(output); // Exclusive: never reuse an old app profile or overwrite a capture run.
const controller = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => controller.abort());
let workbench, player;
let capturedState = false;
const report = {
  version: 1,
  recipe,
  status: "running",
  captures: [],
  cleanup: {},
  startedAt: new Date().toISOString(),
};
async function save() {
  await writeFile(join(output, "capture-report.json"), JSON.stringify(report, null, 2) + "\n");
}
const call = (args) => workbench.call(args);
const mutate = (args) => workbench.mutate(args);
async function fingerprint() {
  const files = execFileSync(
    "git",
    [
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "src",
      "src-tauri/src",
      "src-tauri/Cargo.toml",
      "src-tauri/Cargo.lock",
      "src-tauri/tauri.conf.json",
      "src-tauri/tauri.dev.conf.json",
      "index.html",
      "package.json",
      "package-lock.json",
      "vite.config.js",
    ],
    { cwd: ROOT, encoding: "utf8", windowsHide: true }
  )
    .trim()
    .split(/\r?\n/);
  return sha256(
    Buffer.from(
      (
        await Promise.all(files.map(async (p) => `${p}:${sha256(await readFile(join(ROOT, p)))}`))
      ).join("\n")
    )
  );
}
async function scene() {
  const state = await call(["inspect"]);
  const ui = await call(["ui", "inspect"]);
  assertClearUi(ui);
  const { profile } = await call(["loudness-profile", "describe", state.loudnessProfile.activeId]);
  report.lastScene = { state, ui, profile };
  assertDefaultScene(state, profile, recipe);
  return { state, ui, profile };
}
async function screenshot(name, current) {
  const path = join(output, name);
  const result = await call([
    "visual",
    "screenshot",
    "--target",
    "main",
    "--expected-revision",
    String(current.state.revision),
    "--expected-ui-generation",
    String(current.ui.uiGeneration),
    "--out",
    path,
  ]);
  const meta = await sharp(path).metadata();
  const actual = {
    width: meta.width,
    height: meta.height,
    ...(await workbench.windowEnvironment()),
  };
  assertGeometry(actual, recipe.environment);
  assertClearUi(await call(["ui", "inspect"]));
  return { result, actual, sha256: sha256(await readFile(path)) };
}
try {
  console.log(`Hero run: ${output}`);
  verifyAudio(await readFile(contained(ROOT, recipe.audio.path)), recipe);
  locateVlc();
  const endpoint = resolveRenderEndpointId(recipe.capture.renderEndpointName);
  report.sourceFingerprint = await fingerprint();
  // Launches the fresh workbench, dismisses first-run surfaces and selects the recipe theme.
  workbench = await openWorkbench({ output, recipe, report, signal: controller.signal });
  report.before = await scene();
  if (
    report.before.state.transport.live.state !== "stopped" ||
    report.before.state.transport.files.sessions.length
  )
    throw new Error("Fresh workbench unexpectedly contains measurements.");
  report.geometry = (await screenshot("preflight.png", report.before)).actual;
  await copyFile(contained(ROOT, recipe.publication.webp), join(output, "previous.webp"));
  report.baselineSha256 = sha256(await readFile(join(output, "previous.webp")));
  let devices = await call(["device", "list"]);
  for (
    let attempt = 0;
    attempt < 20 &&
    !devices.devices.some((d) => d.kind === "input" && d.label === recipe.capture.inputLabel);
    attempt++
  ) {
    await delay(500, undefined, { signal: controller.signal });
    devices = await call(["device", "list"]);
  }
  report.devices = devices;
  const cables = devices.devices.filter(
    (d) => d.kind === "input" && d.label === recipe.capture.inputLabel
  );
  if (cables.length !== 1) throw new Error("Expected exactly one matching VB-Cable input.");
  await mutate([
    "device",
    "select",
    cables[0].id,
    "--expected-generation",
    String(devices.generation),
  ]);
  await mutate(["transport", "source", "live"]);
  await mutate(["transport", "live", "clear"]);
  await mutate(["transport", "live", "start"]);
  capturedState = true;
  player = await startPlayer(endpoint, contained(ROOT, recipe.audio.path));
  const started = Date.now();
  player.on("error", (error) => {
    report.playerError = error.message;
    controller.abort();
  });
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
  console.log("LIVE signal verified. Filling the history window.");
  for (const second of recipe.capture.candidateSeconds) {
    await delay(Math.max(0, started + second * 1000 - Date.now()), undefined, {
      signal: controller.signal,
    });
    if (player.exitCode !== null) throw new Error("Audio player exited before capture completed.");
    const current = await scene();
    const before = await call(["measurement", "inspect"]);
    const name = `live-${second}s.png`;
    const captured = await screenshot(name, current);
    const after = await call(["measurement", "inspect"]);
    const issues = [
      ...new Set([...candidateIssues(before, recipe), ...candidateIssues(after, recipe)]),
    ];
    const identity = captured.result.measurement;
    if (
      !Number.isInteger(identity.sequence) ||
      identity.generation !== before.source.sessionGeneration ||
      identity.generation !== after.source.sessionGeneration ||
      identity.sequence < before.sample.sequence ||
      identity.sequence > after.sample.sequence
    )
      issues.push("Capture is not bracketed by the measured samples");
    report.captures.push({
      second,
      file: name,
      ...captured,
      before,
      after,
      issues,
      eligible: issues.length === 0,
    });
    console.log(`${name}: ${issues.length ? issues.join("; ") : "eligible for visual review"}`);
    await save();
  }
  if ((await fingerprint()) !== report.sourceFingerprint)
    throw new Error("Application sources changed during capture; discard this run.");
  if (!report.captures.some((c) => c.eligible))
    throw new Error("No candidate satisfied the required measurement states.");
  const rows = report.captures
    .map(
      (c) =>
        `<section><h2>${c.file} — ${c.eligible ? "Eligible" : "Not eligible"}</h2><div><figure><figcaption>Current published image</figcaption><img src="previous.webp"></figure><figure><figcaption>Candidate at ${c.second}s</figcaption><img src="${c.file}"></figure></div></section>`
    )
    .join("\n");
  await writeFile(
    join(output, "comparison.html"),
    `<!doctype html><meta charset="utf-8"><title>Homepage hero review</title><style>body{background:#171717;color:#eee;font:16px system-ui;margin:24px}section{margin-bottom:40px}section>div{display:flex;gap:16px}figure{margin:0;flex:1;min-width:0}img{width:100%}figcaption{margin:8px 0}</style><h1>Homepage hero review</h1><p>Inspect curves, text, clipping, popovers, tooltips and hover guides. Automation cannot certify visual quality. No image has been published.</p>${rows}`
  );
  const eligible = report.captures.filter((c) => c.eligible);
  const sheets = await Promise.all(
    eligible.map((c) => sharp(join(output, c.file)).resize(640, 400).png().toBuffer())
  );
  await sharp({
    create: {
      width: 1280,
      height: 400 * Math.ceil(sheets.length / 2),
      channels: 3,
      background: "#171717",
    },
  })
    .composite(
      sheets.map((input, i) => ({ input, left: (i % 2) * 640, top: Math.floor(i / 2) * 400 }))
    )
    .png()
    .toFile(join(output, "contact-sheet.png"));
  report.status = "reviewRequired";
  report.manualReview =
    "Check text clipping, hover probes, curves and composition; UI inspection does not expose every tooltip or OS overlay.";
} catch (error) {
  report.status = "failed";
  report.error = error.message;
  process.exitCode = 1;
  console.error(error.message);
} finally {
  if (capturedState) {
    try {
      await mutate(["transport", "live", "stop"]);
      report.cleanup.captureStopped = true;
    } catch (error) {
      report.cleanup.captureStopError = error.message;
    }
  }
  try {
    stopPlayer(player);
    report.cleanup.playerStopped = true;
  } catch (error) {
    report.cleanup.playerStopError = error.message;
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
