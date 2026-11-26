import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createStereoFixtureWav } from "./theme-gallery-lib.mjs";
import { hostPlatform, writeJsonAtomic } from "./acceptance-evidence.mjs";
import { APP_DATA_ROOT_ARG, MAIN_DEV_PORT, portIsFree } from "./dev-worktree.mjs";

import { runTrayContract } from "./accept-tray.mjs";
import { runWindowContract, runWorkbenchContract } from "./accept-window-workbench.mjs";

const target = "toolbar:dialogue-detection";

function launch(command, args, options, log) {
  const fd = openSync(log, "a");
  try {
    const child = spawn(command, args, { ...options, stdio: ["ignore", fd, fd] });
    const exited = new Promise((done) => {
      child.once("exit", (code, signal) => done({ code, signal }));
      child.once("error", (error) => done({ error }));
    });
    return { child, exited };
  } finally {
    closeSync(fd);
  }
}

async function stop(owned) {
  if (!owned) return;
  owned.child.kill();
  const deadline = new AbortController();
  try {
    await Promise.race([
      owned.exited,
      delay(10_000, undefined, { signal: deadline.signal }).then(() => {
        owned.child.kill("SIGKILL");
        throw new Error(`Owned process ${owned.child.pid} did not exit.`);
      }),
    ]);
  } finally {
    deadline.abort();
  }
}

async function until(read, label) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const result = await read();
    if (result) return result;
    await delay(200);
  }
  throw Object.assign(new Error(`Timed out waiting for ${label}.`), { code: "acceptanceTimeout" });
}

async function inspectLinuxWorkbenchProcesses(dataRoot) {
  const registry = join(dataRoot, "multi-instance", "runtime", "instances");
  const files = await readdir(registry).catch(() => []);
  return Promise.all(
    files
      .filter((file) => file.endsWith(".json"))
      .map(async (file) => {
        try {
          const { pid, instanceId } = JSON.parse(await readFile(join(registry, file), "utf8"));
          const stat = await readFile(`/proc/${pid}/stat`, "utf8");
          return {
            instanceId,
            state: stat.slice(stat.lastIndexOf(")") + 2, stat.lastIndexOf(")") + 3),
          };
        } catch {
          return { state: "missing" };
        }
      })
  );
}

export async function runIsolatedAgentControl({
  executable,
  root,
  outDir,
  scenario,
  runDesktop,
  runLiveReconnect,
  environment = {},
}) {
  await mkdir(outDir, { recursive: true });
  const temporaryRoot = resolve(tmpdir());
  const profilePrefix = "plvs-agent-control-";
  const profile = await mkdtemp(join(temporaryRoot, profilePrefix));
  const dataRoot = join(profile, "app");
  const env = {
    ...process.env,
    ...environment,
    PLVS_TEST_IDENTITY_ROOT: join(dataRoot, "multi-instance"),
  };
  delete env.PLVS_INSTANCE_ID;
  const cliLog = [];
  const evidencePath = join(outDir, `${scenario}.json`);
  const git = (args) =>
    spawnSync("git", args, { cwd: root, encoding: "utf8" }).stdout?.trim() ?? null;
  const evidence = {
    head: git(["rev-parse", "HEAD"]),
    workingTreeDirty: Boolean(git(["status", "--porcelain"])),
    scenario,
    platform: hostPlatform(),
    steps: [],
    cli: cliLog,
  };
  let app;
  let vite;
  let instance;
  let restartingFrom;

  function invoke(
    args,
    { allowUnavailable = false, expectedError, instance: selected = instance } = {}
  ) {
    const selector = selected ? ["--instance", selected] : [];
    const child = spawnSync(executable, [...selector, ...args, "--json"], {
      cwd: root,
      env,
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
      timeout: 35_000,
    });
    if (child.error) throw child.error;
    let response;
    try {
      response = JSON.parse(child.stdout);
    } catch {
      throw new Error(`${args.join(" ")} returned invalid JSON: ${child.stderr || child.stdout}`);
    }
    if (
      allowUnavailable &&
      (["appNotRunning", "agentControlNotReady", "frontendNotReady", "discoveryFailed"].includes(
        response.error?.code
      ) ||
        (args[0] === "tray" && response.error?.code === "controlUnavailable"))
    )
      return null;
    cliLog.push({ args: [...selector, ...args], status: child.status, response });
    if (expectedError) {
      assert.notEqual(child.status, 0);
      assert.equal(response.ok, false);
      assert.equal(response.error?.code, expectedError);
      return;
    }
    if (child.status !== 0 || !response.ok) {
      throw new Error(`${args.join(" ")} failed: ${response.error?.message ?? child.stderr}`);
    }
    return response.result;
  }

  async function start(previousInstance = null) {
    const binary = join(dirname(executable), process.platform === "win32" ? "plvs.exe" : "plvs");
    const args = [APP_DATA_ROOT_ARG, dataRoot];
    if (process.platform === "darwin") args.unshift("-ApplePersistenceIgnoreState", "YES");
    app = launch(
      binary,
      args,
      {
        cwd: join(root, "src-tauri"),
        env: {
          ...env,
          WEBVIEW2_USER_DATA_FOLDER: join(profile, "webview"),
          ...(process.platform === "linux"
            ? {
                XDG_DATA_HOME: join(profile, "xdg-data"),
                XDG_CACHE_HOME: join(profile, "xdg-cache"),
              }
            : {}),
        },
      },
      join(outDir, `${scenario}-app.log`)
    );
    return discover(previousInstance, app.child);
  }

  const instances = () => invoke(["instances"], { instance: null }).instances;

  async function discover(previousInstance, child) {
    instance = await until(() => {
      if (child && (child.exitCode !== null || !child.pid))
        throw new Error("Dev app exited during startup.");
      return instances().find(({ instanceId }) => instanceId !== previousInstance)?.instanceId;
    }, "a new isolated workbench");
    await until(() => invoke(["settings", "inspect"], { allowUnavailable: true }), "Agent Control");
    return instance;
  }

  async function configurationRelaunch() {
    const settings = () => invoke(["settings", "inspect"]);
    const revision = () => ["--expected-revision", String(settings().revision)];
    const dialogueEnabled = () => settings().settings.fileDialogueDetection;
    const initial = dialogueEnabled();
    const patch = join(profile, "settings.json");
    await writeFile(patch, JSON.stringify({ fileDialogueDetection: !initial }));
    invoke(["settings", "update", patch, ...revision()]);
    assert.equal(dialogueEnabled(), !initial);
    const backup = join(profile, "before-reset.plvsconfig");
    invoke(["config", "export", "--out", backup]);
    const exported = JSON.parse(await readFile(backup, "utf8"));
    assert.equal(exported.kind, "configuration-profile");
    assert.equal(Object.hasOwn(exported.settings, "agentControlEnabled"), false);

    const resetPlan = invoke(["config", "reset", ...revision(), "--dry-run"]);
    assert.equal(resetPlan.relaunch, false);
    assert.equal(resetPlan.wouldRelaunch, true);
    assert.equal(dialogueEnabled(), !initial);

    const change = async (args) => {
      const tokens = revision();
      restartingFrom = instance;
      assert.equal(invoke(["config", ...args, ...tokens]).relaunch, true);
      const newInstance = await discover(restartingFrom);
      restartingFrom = undefined;
      return newInstance;
    };

    evidence.secondInstance = await change(["reset"]);
    assert.equal(dialogueEnabled(), initial);
    evidence.steps.push("verify reset relaunched with defaults and retained Agent Control access");

    const importPlan = invoke(["config", "import", backup, ...revision(), "--dry-run"]);
    assert.equal(importPlan.relaunch, false);
    assert.equal(dialogueEnabled(), initial);
    evidence.thirdInstance = await change(["import", backup]);
    assert.equal(dialogueEnabled(), !initial);
    evidence.steps.push("verify import relaunched and restored the exported setting");
  }

  async function welcomeRelaunch() {
    const setup = await until(() => {
      const ui = invoke(["ui", "inspect"]);
      const surface = ui.surfaces.find(
        ({ kind, target }) => kind === "update" && target.phase === "preferences"
      );
      return surface && { ui, surface };
    }, "the real first-run Welcome dialog");
    const id = setup.surface.surfaceId;
    const draft = invoke(["editor-draft", "inspect", "welcome", id]);
    assert.equal(draft.document.autoCheck, true);
    const patch = join(profile, "welcome.json");
    await writeFile(
      patch,
      JSON.stringify({ operations: [{ op: "setAutoCheck", autoCheck: false }] })
    );
    const tokens = ({ revision, uiGeneration }) => [
      "--expected-revision",
      String(revision),
      "--expected-ui-generation",
      String(uiGeneration),
    ];
    const applied = invoke([
      "editor-draft",
      "patch",
      "welcome",
      id,
      patch,
      ...tokens(draft),
      "--expected-draft-generation",
      String(draft.draftGeneration),
    ]);
    assert.equal(applied.changed, true);
    assert.deepEqual(invoke(["editor-draft", "inspect", "welcome", id]).document, applied.document);
    assert.equal(applied.document.autoCheck, false);
    invoke(["ui", "decide", "--surface-id", id, "--choice", "save", ...tokens(applied)]);
    await until(() => {
      const ui = invoke(["ui", "inspect"]);
      return !ui.surfaces.some(({ surfaceId }) => surfaceId === id);
    }, "Welcome Continue");
    const saved = invoke(["settings", "inspect"]);
    assert.equal(saved.settings.updates.autoCheck, false);
    evidence.steps.push("patch the Welcome draft, read it back, and press Continue");

    const previous = instance;
    invoke(["workbench", "quit-all", "--expected-revision", String(saved.revision)]);
    await until(() => instances().length === 0, "Welcome workbench shutdown");
    await stop(app);
    app = null;
    evidence.secondInstance = await start(previous);
    assert.equal(invoke(["settings", "inspect"]).settings.updates.autoCheck, false);
    assert.ok(
      !invoke(["ui", "inspect"]).surfaces.some(
        ({ kind, target }) => kind === "update" && target.phase === "preferences"
      )
    );
    evidence.steps.push(
      "verify the Welcome selection persisted and no new Welcome dialog appeared"
    );
  }

  function checkToolbar(pressed, screenshot) {
    // Raise the test window so a background macOS WebView can render the screenshot.
    const window = invoke(["window", "inspect"]);
    const shown = invoke(["window", "show", "--expected-revision", String(window.revision)]);
    assert.equal(shown.visible, true);
    const settings = invoke(["settings", "inspect"]);
    const full = invoke([
      "visual",
      "screenshot",
      "--target",
      "main",
      "--expected-revision",
      String(settings.revision),
      "--out",
      join(outDir, screenshot),
    ]);
    const location = invoke(["ui", "locate", "--target", target]);
    assert.equal(settings.settings.fileDialogueDetection, pressed);
    assert.equal(location.visible, true);
    assert.equal(location.state?.pressed, pressed);
    const cropped = invoke([
      "visual",
      "screenshot",
      "--target-id",
      target,
      "--expected-revision",
      String(location.revision),
      "--out",
      join(outDir, screenshot.replace(".png", "-toggle.png")),
    ]);
    assert.deepEqual(cropped.target, { kind: "named", targetId: target });
    assert.ok(cropped.artifact.width > 0 && cropped.artifact.height > 0);
    assert.ok(cropped.artifact.width < full.artifact.width);
    assert.ok(cropped.artifact.height < full.artifact.height);
  }

  function runFile(action, argument) {
    const { revision } = invoke(["transport", "inspect"]);
    const run = invoke([
      "transport",
      "file",
      action,
      argument,
      "--expected-revision",
      String(revision),
    ]);
    assert.equal(run.status, "accepted");
    assert.ok(run.sessionId && Number.isSafeInteger(run.runId));
    const wait = invoke([
      "transport",
      "file",
      "wait",
      run.sessionId,
      "--run-id",
      String(run.runId),
    ]);
    assert.equal(wait.outcome, "complete");
    return { run, report: invoke(["transport", "file", "report", run.sessionId]).report };
  }

  async function fileSpectrum() {
    const path = join(profile, "spectrum-stereo.wav");
    await writeFile(
      path,
      createStereoFixtureWav({ durationSeconds: 6, sampleRate: 48000, channels: 2 })
    );
    const { run } = runFile("analyze", path);
    for (const offsetSec of [2, 4]) {
      const transport = invoke(["transport", "inspect"]);
      invoke([
        "transport",
        "snapshot",
        "select",
        "--offset-sec",
        String(offsetSec),
        "--expected-revision",
        String(transport.revision),
      ]);
      const spectrum = invoke([
        "measurement",
        "spectrum",
        "--panel-id",
        "spectrum",
        "--resolution",
        "full",
      ]);
      const source = { kind: "file", sessionId: run.sessionId, offsetSec };
      assert.deepEqual(spectrum.displaySource, source);
      assert.deepEqual(invoke(["measurement", "inspect"]).displaySource, source);
      assert.equal(spectrum.sample.freshness, "historical");
      assert.ok(spectrum.bands.length > 0);
      for (const expected of [220, 330]) {
        assert.ok(
          spectrum.peaks.some(({ frequencyHz }) => Math.abs(frequencyHz - expected) < 5),
          `The selected File curve omitted the ${expected} Hz fixture tone.`
        );
      }
    }
    evidence.steps.push("read expected Spectrum peaks and File identity at two historical offsets");
  }

  async function fileDialogueRestart() {
    const sample = join(root, "fixtures", "dialogue-benchmark", "sources", "1320-122617-0000.flac");
    const baseline = runFile("analyze", sample);
    assert.equal(baseline.report.analysis.dialogue.enabled, false);
    assert.equal(baseline.report.summary.dialogueLoudnessLufs, null);
    checkToolbar(false, "file-dialogue-off.png");
    evidence.steps.push("verify analysis and toolbar with detection off");

    const patch = join(profile, "enable-dialogue.json");
    await writeFile(patch, JSON.stringify({ fileDialogueDetection: true }));
    const { revision } = invoke(["settings", "inspect"]);
    const updated = invoke(["settings", "update", patch, "--expected-revision", String(revision)]);
    assert.equal(updated.changed, true);
    assert.ok(updated.warnings.some(({ code }) => code === "fileReanalysisRequired"));
    checkToolbar(true, "file-dialogue-on.png");
    evidence.steps.push("verify the setting and toolbar changed together");

    const enabled = runFile("reanalyze", baseline.run.sessionId);
    assert.equal(enabled.run.sessionId, baseline.run.sessionId);
    assert.notEqual(enabled.run.runId, baseline.run.runId);
    assert.equal(enabled.report.analysis.dialogue.enabled, true);
    assert.equal(enabled.report.analysis.dialogue.engine, updated.state.settings.dialogueVadEngine);
    assert.equal(enabled.report.analysis.dialogue.error, null);
    assert.ok(Number.isFinite(enabled.report.summary.dialogueLoudnessLufs));
    evidence.steps.push("verify reanalysis used the new detector setting");

    await stop(app);
    app = null;
    evidence.secondInstance = await start(evidence.firstInstance);
    assert.notEqual(evidence.firstInstance, evidence.secondInstance);
    const { revision: freshRevision, files } = invoke(["transport", "inspect"]);
    assert.equal(files.sessions.length, 0);
    invoke(["transport", "source", "file", "--expected-revision", String(freshRevision)]);
    checkToolbar(true, "file-dialogue-after-restart.png");
    const restarted = runFile("analyze", sample);
    assert.deepEqual(restarted.report.analysis.dialogue, enabled.report.analysis.dialogue);
    assert.equal(
      restarted.report.summary.dialogueLoudnessLufs,
      enabled.report.summary.dialogueLoudnessLufs
    );
    evidence.steps.push("verify a new process restored the setting and used it for analysis");
  }

  let failure;
  try {
    await mkdir(dataRoot);
    if (scenario !== "welcome-relaunch") {
      await writeJsonAtomic(join(dataRoot, "plvs-settings.json"), {
        agentControlEnabled: true,
        "plvs:settings": {
          closeAction: "quit",
          updatePreferences: { choiceMade: true, autoCheck: false, autoDownload: false },
        },
      });
    }
    const frontend = `http://localhost:${MAIN_DEV_PORT}/@fs/${join(root, "src", "App.jsx").replaceAll("\\", "/")}`;
    if (await portIsFree(MAIN_DEV_PORT)) {
      vite = launch(
        process.execPath,
        [join(root, "node_modules", "vite", "bin", "vite.js")],
        {
          cwd: root,
          env: {
            ...env,
            PLVS_DEV_PORT: String(MAIN_DEV_PORT),
            TAURI_ENV_PLATFORM: process.platform === "win32" ? "windows" : process.platform,
          },
        },
        join(outDir, `${scenario}-vite.log`)
      );
    } else if (env.PLVS_ACCEPTANCE_OWN_VITE === "1") {
      throw new Error(`Desktop acceptance requires a free Vite port (${MAIN_DEV_PORT}).`);
    }
    await until(async () => {
      if (vite && (vite.child.exitCode !== null || !vite.child.pid))
        throw new Error("Vite exited during startup.");
      const response = await fetch(frontend, { signal: AbortSignal.timeout(2000) }).catch(
        () => null
      );
      return response?.ok && (await response.text()).includes("createHotContext");
    }, "the PLVS frontend for this checkout");

    evidence.steps.push("start isolated dev app");
    evidence.firstInstance = await start();
    if (scenario === "desktop") {
      runDesktop({ instanceId: instance, env });
      evidence.steps.push("verify the desktop acceptance suite");
    } else if (scenario === "configuration-relaunch") await configurationRelaunch();
    else if (scenario === "welcome-relaunch") await welcomeRelaunch();
    else if (scenario === "window-platform-contract") {
      await runWindowContract({
        invoke,
        until,
        steps: evidence.steps,
        screenshotPath: join(outDir, "window-minimized.png"),
        windowEvidence: (evidence.window = {}),
        restart: async () => {
          const previous = instance;
          await stop(app);
          app = null;
          await start(previous);
        },
      });
    } else if (scenario === "tray-platform-contract") {
      await runTrayContract({
        invoke,
        instances,
        until,
        steps: evidence.steps,
        firstInstance: instance,
        screenshotPath: join(outDir, "tray.png"),
      });
    } else if (scenario === "workbench-platform-contract")
      await runWorkbenchContract({
        invoke,
        instances,
        until,
        steps: evidence.steps,
        firstInstance: instance,
      });
    else if (scenario === "live-source-reconnect") {
      await runLiveReconnect({ invoke, until });
    } else {
      await fileDialogueRestart();
      await fileSpectrum();
    }
  } catch (error) {
    failure = error;
    evidence.failure = {
      cliCount: cliLog.length,
      code: error.code,
    };
    if (scenario === "workbench-platform-contract" && process.platform === "linux") {
      evidence.failure.workbenches = await inspectLinuxWorkbenchProcesses(dataRoot);
      for (const item of evidence.failure.workbenches) {
        if (!item.instanceId || item.state === "Z") continue;
        try {
          const ui = invoke(["ui", "inspect"], {
            instance: item.instanceId,
            allowUnavailable: true,
          });
          item.reachable = Boolean(ui);
          item.closeConfirmation =
            ui?.surfaces.some(({ kind }) => kind === "closeConfirmation") ?? false;
        } catch {
          item.reachable = false;
        }
      }
    }
    if (scenario === "window-platform-contract" && instance) {
      try {
        invoke(["window", "inspect"]);
      } catch {
        // The original command failure remains the scenario result.
      }
    }
  } finally {
    let cleanupFailed = false;
    if (
      app &&
      [
        "configuration-relaunch",
        "workbench-platform-contract",
        "tray-platform-contract",
        "welcome-relaunch",
      ].includes(scenario)
    ) {
      try {
        if (restartingFrom) await discover(restartingFrom);
        const registered = instances();
        if (registered.length > 0) {
          instance =
            registered.find(({ instanceId }) => instanceId === instance)?.instanceId ??
            registered[0].instanceId;
          const { revision } = await until(
            () => invoke(["inspect"], { allowUnavailable: true }),
            "the isolated workbench before cleanup"
          );
          invoke(["workbench", "quit-all", "--expected-revision", String(revision)]);
          await until(() => instances().length === 0, "isolated workbench shutdown");
        }
      } catch (error) {
        cleanupFailed = true;
        evidence.cleanupError = error.message;
        failure ??= error;
      }
    }
    for (const owned of [app, vite]) {
      await stop(owned).catch((error) => {
        cleanupFailed = true;
        evidence.cleanupError ??= error.message;
        failure ??= error;
      });
    }
    if (
      !cleanupFailed &&
      dirname(profile) === temporaryRoot &&
      basename(profile).startsWith(profilePrefix)
    ) {
      await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 }).catch(
        (error) => {
          failure ??= error;
        }
      );
    }
    evidence.status = failure ? "failed" : "passed";
    if (failure) evidence.error = failure.message;
    await writeJsonAtomic(evidencePath, evidence);
  }
  if (failure) throw Object.assign(failure, { evidencePath });
  return evidencePath;
}
