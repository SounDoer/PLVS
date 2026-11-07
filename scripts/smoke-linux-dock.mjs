#!/usr/bin/env node
// Own an isolated dev app; never change a user's running workbench or capture rig.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

assert.equal(process.platform, "linux", "Run this smoke on an unlocked Linux desktop.");
const executable = resolve(process.argv[2] ?? "src-tauri/target/debug/plvs");
const output = resolve(
  process.argv[3] ?? `artifacts/linux-dock-smoke/${new Date().toISOString().replaceAll(":", "-")}`
);
mkdirSync(output, { recursive: true });
const data = mkdtempSync(join(output, "app-data-"));
let env = {
  ...process.env,
  PLVS_TEST_IDENTITY_ROOT: join(data, "multi-instance"),
};
// Exercise the same backend selection as a desktop launcher, even if the invoking shell forces X11.
delete env.GDK_BACKEND;
const log = openSync(join(output, "app.log"), "wx");
let child = spawn(executable, ["--plvs-test-app-data-root", data], {
  env,
  stdio: ["ignore", log, log],
});
const commands = [];
const observations = [];
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
async function stop(signal = "SIGTERM") {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill(signal);
  await Promise.race([new Promise((done) => child.once("exit", done)), pause(3000)]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await new Promise((done) => child.once("exit", done));
  }
  // Process exit precedes Mutter publishing the new work area on the X root window.
  for (let attempt = 0; attempt < 20 && workArea() !== baseline; attempt += 1) await pause(100);
}
function call(args) {
  const response = spawnSync(executable, ["--cli", "com.soundoer.plvs.dev", ...args, "--json"], {
    env,
    encoding: "utf8",
    timeout: 30_000,
  });
  if (response.error) throw response.error;
  const envelope = JSON.parse(response.stdout);
  commands.push({ args, ...envelope });
  if (!envelope.ok) throw Object.assign(new Error(JSON.stringify(envelope.error)), envelope.error);
  return envelope.result;
}
async function until(check, label) {
  const deadline = Date.now() + 30_000;
  let last;
  while (Date.now() < deadline) {
    assert.equal(child.exitCode, null, "Owned app exited.");
    try {
      const value = check();
      if (value) return value;
    } catch (error) {
      last = error;
    }
    await pause(200);
  }
  throw new Error(`${label} did not settle: ${last?.message ?? "deadline"}`);
}
function workArea() {
  const result = spawnSync("xprop", ["-root", "_NET_WORKAREA"], { encoding: "utf8" });
  assert.equal(result.status, 0, "Install xprop (x11-utils) for native work-area verification.");
  return result.stdout.trim();
}
function nativeVisuals() {
  const tree = spawnSync("xwininfo", ["-root", "-tree"], { encoding: "utf8" });
  assert.equal(tree.status, 0, "Install xwininfo (x11-utils) to verify native transparency.");
  return tree.stdout.split("\n").flatMap((line) => {
    const match = line.match(/^\s*(0x[0-9a-f]+) "(PLVS[^\"]*)"/);
    if (!match) return [];
    const pid = spawnSync("xprop", ["-id", match[1], "_NET_WM_PID"], { encoding: "utf8" });
    if (Number(pid.stdout.match(/= (\d+)/)?.[1]) !== child.pid) return [];
    const info = spawnSync("xwininfo", ["-id", match[1]], { encoding: "utf8" });
    const hints = spawnSync("xprop", ["-id", match[1], "WM_HINTS"], { encoding: "utf8" });
    return [
      {
        title: match[2],
        depth: Number(info.stdout.match(/Depth: (\d+)/)?.[1]),
        acceptsInput: hints.stdout.includes("Client accepts input or input focus: True"),
      },
    ];
  });
}
function mutate(args) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = call(["inspect"]);
    const guarded = [...args, "--expected-revision", String(current.revision)];
    try {
      // Native normal-window restoration can finish after Dock exit's acknowledgement and
      // advance the scene revision. Reinspect and replan the explicit intent before applying it.
      if (attempt > 0) call([...guarded, "--dry-run"]);
      return call(guarded);
    } catch (error) {
      if (error.code !== "revisionConflict" || attempt === 2) throw error;
    }
  }
}
const ui = () => call(["ui", "inspect"]);
function nav(args) {
  const state = ui();
  return call([
    ...args,
    "--expected-revision",
    String(state.revision),
    "--expected-ui-generation",
    String(state.uiGeneration),
  ]);
}
const screenshot = (name, target = "main") =>
  until(
    () => call(["visual", "screenshot", "--target", target, "--out", join(output, `${name}.png`)]),
    `${target} screenshot readiness`
  );
let failure;
const baseline = workArea();
try {
  await until(
    () => existsSync(join(data, "multi-instance", "migration-complete.json")),
    "atomic storage initialization"
  );
  await until(() => call(["capabilities"]), "frontend readiness");
  assert.equal(call(["dock", "describe"]).supported, true);
  assert.equal(call(["dock", "describe"]).aboveFullScreen.writable, false);
  // Dismiss only the first-run surfaces of this freshly created profile.
  await pause(1000);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const state = ui();
    if (state.surfaces.length === 0) {
      await pause(200);
      continue;
    }
    const surface = state.surfaces.at(-1);
    assert.ok(
      ["update", "quickTour"].includes(surface.kind),
      `Unexpected startup surface: ${surface.kind}`
    );
    nav([
      "ui",
      surface.supportedActions.includes("cancel") ? "cancel" : "close",
      surface.surfaceId,
    ]);
  }
  await screenshot("normal-before");
  const normalViews = nav(["ui", "show", "toolbar-menu", "--menu", "views"]);
  await screenshot("normal-views");
  nav(["ui", "close", normalViews.surface.surfaceId]);
  for (const edge of ["top", "bottom"]) {
    let firstArea;
    for (const height of [90, 150, 90]) {
      mutate([
        "dock",
        "enter",
        "--edge",
        edge,
        "--height",
        String(height),
        "--reserve-space",
        "true",
      ]);
      await pause(350);
      const area = await until(
        () => workArea() !== baseline && workArea(),
        "work-area reservation"
      );
      if (height === 90 && firstArea)
        assert.equal(area, firstArea, "Repeated resize must not accumulate reservation.");
      if (height === 90) firstArea = area;
      const dock = call(["dock", "inspect"]);
      observations.push({ edge, height, area, dock });
      assert.equal(dock.reserveSpace, true);
      assert.equal(dock.height, height);
      await screenshot(`${edge}-${height}-${observations.length}`);
      const png = readFileSync(join(output, `${edge}-${height}-${observations.length}.png`));
      assert.equal(
        png.readUInt32BE(20),
        height,
        "This 1x desktop must render a strip at the requested height."
      );
    }
    nav(["ui", "show", "dock-toolbar"]);
    await screenshot(`${edge}-toolbar`, "dock-header");
    const views = nav(["ui", "show", "toolbar-menu", "--menu", "views"]);
    await screenshot(`${edge}-views`, "dock-editor");
    nav(["ui", "close", views.surface.surfaceId]);
    const level = call(["dock", "inspect"]).panels.find((panel) => panel.moduleId === "levelMeter");
    const panel = nav(["ui", "show", "panel-settings", "--panel-id", level.id]);
    await screenshot(`${edge}-panel-editor`, "dock-editor");
    nav(["ui", "close", panel.surface.surfaceId]);
    const settings = nav(["ui", "show", "settings", "--section", "appearance"]);
    await screenshot(`${edge}-settings`, "dock-settings");
    const visuals = nativeVisuals();
    assert.ok(visuals.length >= 3, "Main and accessory X11 windows must be present.");
    for (const visual of visuals) {
      assert.equal(visual.depth, 32, `${visual.title} needs an RGBA native visual.`);
      assert.equal(visual.acceptsInput, true, `${visual.title} must accept keyboard focus.`);
    }
    observations.push({ scenario: "native-rgba-visuals", edge, visuals });
    nav(["ui", "close", settings.surface.surfaceId]);
    mutate(["window", "hide"]);
    await until(() => workArea() === baseline, "suspension releases space");
    mutate(["window", "show"]);
    await until(() => workArea() !== baseline, "resume reserves space");
    mutate(["dock", "exit"]);
    await until(() => workArea() === baseline, "exit restores work area");
  }
  mutate(["dock", "enter", "--edge", "bottom", "--reserve-space", "false"]);
  await until(() => workArea() === baseline, "overlay reserves nothing");
  mutate(["dock", "exit"]);
  await screenshot("normal-after");
  // A fresh process must restore the actual Dock, not just the frontend's saved flag.
  mutate(["dock", "enter", "--edge", "bottom", "--height", "90", "--reserve-space", "true"]);
  await until(() => workArea() !== baseline, "pre-restart reservation");
  await stop();
  assert.equal(workArea(), baseline);
  child = spawn(executable, ["--plvs-test-app-data-root", data], {
    env,
    stdio: ["ignore", log, log],
  });
  await until(() => call(["dock", "inspect"]).enabled === true, "persisted Dock restoration");
  await until(() => workArea() !== baseline, "restored native reservation");
  await screenshot("restarted-dock");
  await stop("SIGKILL");
  for (let attempt = 0; attempt < 20 && workArea() !== baseline; attempt += 1) await pause(100);
  assert.equal(workArea(), baseline, "A dead X client must release its strut.");
  observations.push({ scenario: "restart-and-crash-cleanup", passed: true });

  // The same desktop also offers native Wayland. It must explicitly refuse Dock.
  if (process.env.WAYLAND_DISPLAY) {
    const nativeData = mkdtempSync(join(output, "wayland-data-"));
    env = {
      ...env,
      GDK_BACKEND: "wayland",
      PLVS_TEST_IDENTITY_ROOT: join(nativeData, "multi-instance"),
    };
    child = spawn(executable, ["--plvs-test-app-data-root", nativeData], {
      env,
      stdio: ["ignore", log, log],
    });
    await until(
      () => existsSync(join(nativeData, "multi-instance", "migration-complete.json")),
      "Wayland storage initialization"
    );
    const described = await until(() => call(["dock", "describe"]), "Wayland frontend readiness");
    assert.equal(described.supported, false);
    const before = call(["dock", "inspect"]);
    const refused = spawnSync(
      executable,
      [
        "--cli",
        "com.soundoer.plvs.dev",
        "dock",
        "enter",
        "--dry-run",
        "--expected-revision",
        String(before.revision),
        "--json",
      ],
      { env, encoding: "utf8", timeout: 30_000 }
    );
    const envelope = JSON.parse(refused.stdout);
    assert.equal(envelope.ok, false);
    assert.ok(["controlUnavailable", "controlsUnavailable"].includes(envelope.error.code));
    assert.equal(call(["dock", "inspect"]).enabled, false);
    observations.push({ scenario: "native-wayland-refusal", passed: true });
  }
} catch (error) {
  failure = String(error.stack ?? error);
  process.exitCode = 1;
  console.error(failure);
} finally {
  await stop();
  // X destroys the client's strut even after abnormal termination.
  for (let attempt = 0; attempt < 20 && workArea() !== baseline; attempt += 1) await pause(100);
  const restored = workArea() === baseline;
  if (!restored) process.exitCode = 1;
  const git = (args) => spawnSync("git", args, { encoding: "utf8" }).stdout;
  writeFileSync(
    join(output, "result.json"),
    JSON.stringify(
      {
        passed: !failure && restored,
        failure,
        restored,
        baseline,
        observations,
        session: {
          type: process.env.XDG_SESSION_TYPE,
          desktop: process.env.XDG_CURRENT_DESKTOP,
          backend: "default (no GDK_BACKEND override)",
        },
        sourceHead: git(["rev-parse", "HEAD"]).trim(),
        sourceStatus: git(["status", "--short"]),
        executableSha256: createHash("sha256").update(readFileSync(executable)).digest("hex"),
        note: "Local development evidence, not release acceptance. RDP may affect focus and geometry.",
      },
      null,
      2
    )
  );
  writeFileSync(join(output, "commands.json"), JSON.stringify(commands, null, 2));
}
console.log(`Linux Dock smoke ${failure ? "failed" : "completed"}: ${output}`);
