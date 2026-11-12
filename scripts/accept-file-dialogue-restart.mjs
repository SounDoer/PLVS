import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { writeJsonAtomic } from "./acceptance-evidence.mjs";
import { APP_DATA_ROOT_ARG, MAIN_DEV_PORT, portIsFree } from "./dev-worktree.mjs";

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
  throw new Error(`Timed out waiting for ${label}.`);
}

export async function runFileDialogueRestart({ executable, root, outDir }) {
  await mkdir(outDir, { recursive: true });
  const temporaryRoot = resolve(tmpdir());
  const profile = await mkdtemp(join(temporaryRoot, "plvs-file-dialogue-"));
  const dataRoot = join(profile, "app");
  const env = { ...process.env, PLVS_TEST_IDENTITY_ROOT: join(dataRoot, "multi-instance") };
  const cliLog = [];
  const evidencePath = join(outDir, "file-dialogue-restart.json");
  const git = (args) =>
    spawnSync("git", args, { cwd: root, encoding: "utf8" }).stdout?.trim() ?? null;
  const evidence = {
    head: git(["rev-parse", "HEAD"]),
    workingTreeDirty: Boolean(git(["status", "--porcelain"])),
    scenario: "file-dialogue-restart",
    steps: [],
    cli: cliLog,
  };
  let app;
  let vite;
  let instance;

  function invoke(args, { allowUnavailable = false, offline = false } = {}) {
    const selector = !offline && instance ? ["--instance", instance] : [];
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
      ["appNotRunning", "agentControlNotReady", "frontendNotReady", "discoveryFailed"].includes(
        response.error?.code
      )
    )
      return null;
    cliLog.push({ args, status: child.status, response });
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
      join(outDir, "file-dialogue-app.log")
    );
    instance = await until(() => {
      if (app.child.exitCode !== null || !app.child.pid)
        throw new Error("Dev app exited during startup.");
      const listed = invoke(["instances"], { offline: true }).instances;
      return listed.find(({ instanceId }) => instanceId !== previousInstance)?.instanceId;
    }, "a new isolated workbench");
    await until(() => invoke(["settings", "inspect"], { allowUnavailable: true }), "Agent Control");
    return instance;
  }

  function checkToolbar(pressed, screenshot) {
    const settings = invoke(["settings", "inspect"]);
    assert.equal(settings.settings.fileDialogueDetection, pressed);
    const location = invoke(["ui", "locate", "--target", target]);
    assert.equal(location.visible, true);
    assert.equal(location.state?.pressed, pressed);
    invoke([
      "visual",
      "screenshot",
      "--target",
      "main",
      "--expected-revision",
      String(location.revision),
      "--out",
      join(outDir, screenshot),
    ]);
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

  let failure;
  try {
    await mkdir(dataRoot);
    await writeJsonAtomic(join(dataRoot, "plvs-settings.json"), {
      agentControlEnabled: true,
      "plvs:settings": {
        closeAction: "quit",
        updatePreferences: { choiceMade: true, autoCheck: false, autoDownload: false },
      },
    });
    const frontend = `http://localhost:${MAIN_DEV_PORT}/@fs/${join(root, "src", "App.jsx").replaceAll("\\", "/")}`;
    if (await portIsFree(MAIN_DEV_PORT)) {
      vite = launch(
        process.execPath,
        [join(root, "node_modules", "vite", "bin", "vite.js")],
        {
          cwd: root,
          env: { ...env, PLVS_DEV_PORT: String(MAIN_DEV_PORT) },
        },
        join(outDir, "file-dialogue-vite.log")
      );
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
  } catch (error) {
    failure = error;
  } finally {
    for (const owned of [app, vite]) {
      await stop(owned).catch((error) => {
        failure ??= error;
      });
    }
    if (dirname(profile) === temporaryRoot && basename(profile).startsWith("plvs-file-dialogue-")) {
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
