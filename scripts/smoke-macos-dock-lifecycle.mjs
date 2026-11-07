#!/usr/bin/env node
/** Native Panel teardown regression. Runs only an owned, isolated packaged dev app. */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
assert.equal(process.platform, "darwin", "This smoke requires an unlocked macOS desktop");
const executable = resolve(
  process.argv[2] ?? "src-tauri/target/release/bundle/macos/PLVS Dev.app/Contents/MacOS/plvs"
);
const output = process.argv[3]
  ? resolve(process.argv[3])
  : mkdtempSync(join(tmpdir(), "plvs-dock-lifecycle-"));
mkdirSync(output, { recursive: true });
const hoverProbe = join(output, "dock-toolbar-hover-probe");
for (const [command, args] of [
  [
    "xcrun",
    [
      "clang",
      "-fobjc-arc",
      "-framework",
      "AppKit",
      "-framework",
      "WebKit",
      join(root, "scripts/macos/dock-toolbar-hover-probe.m"),
      "-o",
      hoverProbe,
    ],
  ],
  [hoverProbe, []],
]) {
  const response = spawnSync(command, args, { encoding: "utf8", timeout: 20000 });
  assert.equal(response.status, 0, response.error?.message ?? response.stderr + response.stdout);
  if (command === hoverProbe) {
    writeFileSync(join(output, "native-hover.json"), response.stdout);
  }
}
// Even an existing evidence directory gets a fresh root; never inherit a user's editors.
const data = mkdtempSync(join(output, "app-data-"));
const env = { ...process.env, PLVS_TEST_IDENTITY_ROOT: join(data, "multi-instance") };
delete env.PLVS_INSTANCE_ID;
const logfile = openSync(join(output, "app.log"), "a");
const child = spawn(
  executable,
  ["-ApplePersistenceIgnoreState", "YES", "--plvs-test-app-data-root", data],
  { env, stdio: ["ignore", logfile, logfile] }
);
const results = [{ scenario: "toolbar-hover-before-first-click", passed: true }];
const commands = [];
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
function call(args) {
  const response = spawnSync(executable, ["--cli", "com.soundoer.plvs.dev", ...args, "--json"], {
    env,
    encoding: "utf8",
    timeout: 25000,
  });
  if (response.error) throw response.error;
  const envelope = JSON.parse(response.stdout);
  commands.push({ at: new Date().toISOString(), args, ...envelope });
  assert.equal(envelope.ok, true, JSON.stringify(envelope));
  return envelope.result;
}
async function until(check, label) {
  const deadline = Date.now() + 15000;
  let lastError;
  while (Date.now() < deadline) {
    assert.equal(child.signalCode, null, `App terminated with ${child.signalCode}`);
    assert.equal(child.exitCode, null, `App exited with ${child.exitCode}`);
    try {
      const value = check();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await pause(100);
  }
  throw new Error(`${label} did not settle: ${lastError?.message ?? "deadline"}`);
}
const ui = () => call(["ui", "inspect"]);
const nav = (args) => {
  const state = ui();
  return call([
    ...args,
    "--expected-revision",
    String(state.revision),
    "--expected-ui-generation",
    String(state.uiGeneration),
  ]);
};
const mutate = (args) => call([...args, "--expected-revision", String(call(["inspect"]).revision)]);
async function closed() {
  await until(() => {
    const state = ui();
    return state.surfaces.length === 0 && state.activeBlockingEditors.length === 0;
  }, "editor close");
  // A UI acknowledgement precedes native teardown. Let destruction finish before recreation.
  await pause(250);
  call(["inspect"]);
}
let failure;
try {
  await until(() => call(["instances"]).instances.length === 1, "isolated app startup");
  const capabilities = await until(() => call(["capabilities"]), "frontend readiness");
  assert.equal(capabilities.runtime.identifier, "com.soundoer.plvs.dev");
  assert.equal(call(["inspect"]).transport.live.state, "stopped");
  await until(
    () => ui().surfaces.some((surface) => surface.kind === "update"),
    "fresh-profile Update Preferences"
  );
  for (const surface of ui().surfaces) {
    assert.ok(["update", "quickTour"].includes(surface.kind), "Unexpected startup editor");
    nav([
      "ui",
      surface.supportedActions.includes("cancel") ? "cancel" : "close",
      surface.surfaceId,
    ]);
  }
  await until(
    () => ui().surfaces.find((surface) => surface.kind === "quickTour"),
    "fresh-profile Quick Tour invitation"
  );
  nav(["ui", "close", ui().surfaces.find((surface) => surface.kind === "quickTour").surfaceId]);
  await closed();
  for (const edge of ["top", "bottom"]) {
    mutate(["dock", "enter", "--edge", edge, "--reserve-space", "false"]);
    for (let cycle = 0; cycle < 3; cycle += 1) {
      for (const kind of ["theme-editor", "loudness-profile-editor", "feedback"]) {
        const opened = nav([
          "ui",
          "show",
          kind,
          ...(kind === "feedback" ? [] : ["--mode", "create"]),
        ]);
        nav(["ui", "cancel", opened.surface.surfaceId]);
        await closed();
        results.push({ scenario: "authoring-cancel", edge, cycle, kind, passed: true });
      }
    }
    const opened = nav(["ui", "show", "theme-editor", "--mode", "create"]);
    mutate(["dock", "exit"]);
    await until(
      () => ui().surfaces.some((s) => s.kind === "themeEditor"),
      "normal editor transfer"
    );
    mutate(["dock", "enter"]);
    const transferred = await until(
      () => ui().surfaces.find((s) => s.kind === "themeEditor"),
      "Dock editor recreation"
    );
    assert.equal(transferred.target.draftId, opened.surface.target.draftId);
    nav(["ui", "cancel", transferred.surfaceId]);
    await closed();
    results.push({ scenario: "editor-form-transfer", edge, passed: true });
  }
  nav(["ui", "show", "settings", "--section", "appearance"]);
  nav(["ui", "close", ui().topSurfaceId]);
  const started = Date.now();
  console.log("Waiting for the real 60-second Settings retirement deadline...");
  while (Date.now() - started < 65000) {
    await pause(1000);
    call(["inspect"]); // The baseline aborts during this interval.
  }
  nav(["ui", "show", "settings", "--section", "appearance"]);
  nav(["ui", "close", ui().topSurfaceId]);
  results.push({ scenario: "settings-idle-retirement-and-recreation", passed: true });
  nav(["ui", "show", "toolbar-menu", "--menu", "sources"]);
  nav(["ui", "close", ui().surfaces.find((s) => s.kind === "toolbarMenu").surfaceId]);
  mutate(["dock", "exit"]);
  console.log("Waiting for toolbar, panel and Settings retirement after Dock exit...");
  const exitAt = Date.now();
  while (Date.now() - exitAt < 65000) {
    await pause(1000);
    call(["inspect"]);
  }
  mutate(["dock", "enter"]);
  nav(["ui", "show", "toolbar-menu", "--menu", "sources"]);
  nav(["ui", "close", ui().surfaces.find((s) => s.kind === "toolbarMenu").surfaceId]);
  results.push({ scenario: "toolbar-panel-idle-retirement-and-recreation", passed: true });
  console.log(`Passed ${results.length} native lifecycle scenarios. Evidence: ${output}`);
} catch (error) {
  failure = String(error.stack ?? error);
  process.exitCode = 1;
  console.error(failure);
} finally {
  writeFileSync(join(output, "commands.json"), JSON.stringify(commands, null, 2));
  const git = (args) => spawnSync("git", args, { cwd: root, encoding: "utf8" }).stdout;
  const diff = git(["diff", "HEAD"]);
  writeFileSync(
    join(output, "result.json"),
    JSON.stringify(
      {
        passed: !failure,
        failure,
        results,
        sourceHead: git(["rev-parse", "HEAD"]).trim(),
        sourceStatus: git(["status", "--short"]),
        trackedDiffSha256: createHash("sha256").update(diff).digest("hex"),
        executableSha256: createHash("sha256").update(readFileSync(executable)).digest("hex"),
        note: "Local native regression evidence; not release acceptance or renderer-count measurements.",
      },
      null,
      2
    )
  );
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGTERM");
    await Promise.race([new Promise((done) => child.once("exit", done)), pause(2000)]);
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
}
