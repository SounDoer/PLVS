// Capture the unmodified default workbench from real audio routed through VB-Cable.
// Use only a disposable development instance; this clears its LIVE history.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { resolveRenderEndpointId, startPlayer, stopPlayer } from "../capture-rig.mjs";

const execute = promisify(execFile);
const [audioArgument, outputArgument] = process.argv.slice(2);
if (!audioArgument || !outputArgument || !process.env.PLVS_TEST_IDENTITY_ROOT) {
  throw new Error(
    "Set PLVS_TEST_IDENTITY_ROOT for a disposable dev instance, then pass <audio.wav> <output-dir>."
  );
}
const audioPath = resolve(audioArgument);
const output = resolve(outputArgument);
const cli = resolve("src-tauri/target/debug/plvs-cli.exe");
await mkdir(output, { recursive: true });
async function call(args) {
  const { stdout } = await execute(cli, [...args, "--json"], {
    windowsHide: true,
    timeout: 25000,
    maxBuffer: 16 * 1024 * 1024,
  });
  const envelope = JSON.parse(stdout.trim());
  if (!envelope.ok) throw new Error(JSON.stringify(envelope.error));
  return envelope.result;
}
async function mutate(args) {
  const current = await call(["inspect"]);
  return call([...args, "--expected-revision", String(current.revision)]);
}
const capabilities = await call(["capabilities"]);
for (const method of [
  "visual.screenshot",
  "transport.live.start",
  "transport.live.stop",
  "measurement.inspect",
]) {
  if (!capabilities.methods.includes(method)) throw new Error(`Missing ${method}`);
}
const before = await call(["inspect"]);
if (before.transport.live.state !== "stopped" || before.transport.files.analyzingId) {
  throw new Error("The disposable workbench must be stopped and idle before capture.");
}
const devices = await call(["device", "list"]);
const cables = devices.devices.filter(
  (d) => d.kind === "input" && d.label.startsWith("CABLE Output")
);
if (cables.length !== 1) throw new Error("Expected exactly one VB-Cable input.");
const report = {
  app: before.app,
  audio: {
    path: audioPath,
    sha256: createHash("sha256")
      .update(await readFile(audioPath))
      .digest("hex"),
  },
  source: "live",
  before,
  captures: [],
  timing:
    "Seconds after VLC launch; capture metadata records the actual LIVE generation and sequence. Native scheduling is not pixel-deterministic.",
};
let player;
try {
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
  player = startPlayer(resolveRenderEndpointId(), audioPath);
  const started = Date.now();
  for (const second of [62, 66, 70, 74, 78, 82]) {
    while (Date.now() - started < second * 1000) {
      await new Promise((r) =>
        setTimeout(r, Math.min(500, second * 1000 - (Date.now() - started)))
      );
    }
    const measurement = await call(["measurement", "inspect"]);
    if (
      measurement.source.kind !== "live" ||
      measurement.sample.freshness !== "fresh" ||
      !Number.isFinite(measurement.loudness.integratedLufs)
    ) {
      throw new Error("LIVE audio is missing or stale; refusing an empty promotional screenshot.");
    }
    const state = await call(["inspect"]);
    if (JSON.stringify(state.workspace) !== JSON.stringify(before.workspace)) {
      // Runtime analysis metadata can change with the input; compare authored layout and controls below.
      if (
        JSON.stringify(state.workspace.layout) !== JSON.stringify(before.workspace.layout) ||
        JSON.stringify(state.workspace.panels.map((p) => [p.id, p.controls, p.axes])) !==
          JSON.stringify(before.workspace.panels.map((p) => [p.id, p.controls, p.axes]))
      ) {
        throw new Error("Workspace layout or panel settings changed during capture.");
      }
    }
    const path = join(output, `live-${second}s.png`);
    const screenshot = await call([
      "visual",
      "screenshot",
      "--target",
      "main",
      "--expected-revision",
      String(state.revision),
      "--out",
      path,
    ]);
    report.captures.push({ second, path, measurement, screenshot });
    console.log(`Captured LIVE at ${second}s: ${path}`);
    await writeFile(join(output, "capture-report.json"), JSON.stringify(report, null, 2) + "\n");
  }
} finally {
  try {
    await mutate(["transport", "live", "stop"]);
  } finally {
    stopPlayer(player);
  }
  const currentDevices = await call(["device", "list"]);
  await mutate([
    "device",
    "select",
    before.device.selection.requestedId,
    "--expected-generation",
    String(currentDevices.generation),
  ]);
  report.after = await call(["inspect"]);
  await writeFile(join(output, "capture-report.json"), JSON.stringify(report, null, 2) + "\n");
}
