// Disposable Windows workbench for the homepage hero, Dock and feature captures: its own Vite server
// (hot reload off), a fresh app-data root and WebView profile, and Agent Control through the dev
// CLI. Never attaches to a user's running instance; cleanup stops only processes it started.
import process from "node:process";
import { execFile, execFileSync, spawn } from "node:child_process";
import { promisify } from "node:util";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import sharp from "sharp";
import { ROOT, sha256, assertGeometry } from "./hero-lib.mjs";
import { findStartupSurface } from "./homepage-lib.mjs";

const execute = promisify(execFile);
const appPath = join(ROOT, "src-tauri/target/dev-identity/debug/plvs.exe");
const cli = join(ROOT, "src-tauri/target/dev-identity/debug/plvs-cli.exe");
const REQUIRED_METHODS = [
  "ui.inspect",
  "ui.cancel",
  "visual.screenshot",
  "device.select",
  "transport.live.start",
  "transport.live.stop",
  "transport.snapshot.select",
  "measurement.inspect",
  "measurement.waitUntil",
  "theme.select",
];

async function checkNativeBuild() {
  const built = (await stat(appPath)).mtimeMs;
  async function visit(dir) {
    for (const item of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, item.name);
      if (item.isDirectory()) await visit(path);
      else if (item.name.endsWith(".rs") && (await stat(path)).mtimeMs > built)
        throw new Error(
          "Native sources are newer than plvs.exe. Build the current dev app with npm run desktop:dev first."
        );
    }
  }
  await visit(join(ROOT, "src-tauri/src"));
  for (const name of [
    "Cargo.toml",
    "Cargo.lock",
    "build.rs",
    "tauri.conf.json",
    "tauri.dev.conf.json",
  ]) {
    if ((await stat(join(ROOT, "src-tauri", name))).mtimeMs > built)
      throw new Error(`${name} changed after the native build. Run npm run desktop:dev first.`);
  }
  await stat(cli);
}

/**
 * Starts the workbench and returns its control surface. `report` receives launch facts and
 * the app log; the caller owns writing it. Always call `close()` in a finally block.
 */
export async function openWorkbench({ output, recipe, report, signal }) {
  const appData = join(output, "app-data");
  const env = { ...process.env, PLVS_TEST_IDENTITY_ROOT: join(appData, "multi-instance") };
  let app, server, instanceId;

  async function call(args, targeted = true) {
    const prefix = targeted && instanceId ? ["--instance", instanceId] : [];
    const { stdout } = await execute(cli, [...prefix, ...args, "--json"], {
      cwd: ROOT,
      env,
      windowsHide: true,
      timeout: 60000,
      maxBuffer: 16 * 1024 * 1024,
    }).catch((error) => {
      throw new Error(error.stdout || error.message);
    });
    const envelope = JSON.parse(stdout.trim());
    if (!envelope.ok) throw new Error(JSON.stringify(envelope.error));
    return envelope.result;
  }
  async function mutate(args) {
    const state = await call(["inspect"]);
    return call([...args, "--expected-revision", String(state.revision)]);
  }
  async function patch(args, body, name = "patch.json") {
    const path = join(output, name);
    await writeFile(path, JSON.stringify(body, null, 2) + "\n");
    return mutate([...args, path]);
  }
  async function windowEnvironment() {
    const { stdout } = await execute(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        join(ROOT, "scripts/marketing/window-environment.ps1"),
        "-TargetProcessId",
        String(app.pid),
      ],
      { windowsHide: true, timeout: 15000 }
    );
    return JSON.parse(stdout.trim());
  }
  /** Captures one image and checks its pixel size plus the window's actual DPI and text scale. */
  async function screenshot(name, { target, panelId, width, height }) {
    const state = await call(["inspect"]);
    const ui = await call(["ui", "inspect"]);
    if (ui.surfaces.length || ui.activeBlockingEditors.length)
      throw new Error(`UI is obstructed before ${name}: ${JSON.stringify(ui.surfaces)}`);
    const path = join(output, `${name}.png`);
    const args = [
      "visual",
      "screenshot",
      "--target",
      target,
      "--expected-revision",
      String(state.revision),
      "--expected-ui-generation",
      String(ui.uiGeneration),
      "--out",
      path,
    ];
    if (panelId) args.push("--panel-id", panelId);
    const capture = await call(args);
    const meta = await sharp(path).metadata();
    const actual = { width: meta.width, height: meta.height, ...(await windowEnvironment()) };
    assertGeometry(actual, {
      width,
      height,
      windowDpi: recipe.environment.windowDpi,
      textScalePercent: recipe.environment.textScalePercent,
    });
    const record = { state, ui, capture, actual, sha256: sha256(await readFile(path)) };
    await writeFile(join(output, `${name}.json`), JSON.stringify(record, null, 2) + "\n");
    return record;
  }
  /** Dismisses each first-run surface the recipe names through its own cancel behavior. */
  async function dismissStartupSurfaces() {
    const dismissed = [];
    for (const spec of recipe.startup.dismissSurfaces) {
      const deadline = Date.now() + recipe.startup.surfaceTimeoutMs;
      let ui = await call(["ui", "inspect"]);
      let surface = findStartupSurface(ui, spec);
      while (!surface) {
        if (Date.now() > deadline)
          throw new Error(
            `Fresh profile never showed the ${spec.kind}/${spec.phase} surface; update the recipe if first run changed.`
          );
        await delay(500, undefined, { signal });
        ui = await call(["ui", "inspect"]);
        surface = findStartupSurface(ui, spec);
      }
      const state = await call(["inspect"]);
      await call([
        "ui",
        spec.action,
        surface.surfaceId,
        "--expected-revision",
        String(state.revision),
        "--expected-ui-generation",
        String(ui.uiGeneration),
      ]);
      dismissed.push({ kind: surface.kind, target: surface.target });
    }
    const ui = await call(["ui", "inspect"]);
    if (ui.surfaces.length || ui.activeBlockingEditors.length)
      throw new Error(`UI still obstructed after startup: ${JSON.stringify(ui.surfaces)}`);
    return dismissed;
  }
  /** Selects the recipe's VB-Cable input; device discovery can lag the first inspect. */
  async function selectInput(label) {
    let devices = await call(["device", "list"]);
    for (
      let attempt = 0;
      attempt < 20 && !devices.devices.some((d) => d.kind === "input" && d.label === label);
      attempt++
    ) {
      await delay(500, undefined, { signal });
      devices = await call(["device", "list"]);
    }
    const matches = devices.devices.filter((d) => d.kind === "input" && d.label === label);
    if (matches.length !== 1) throw new Error(`Expected exactly one input named ${label}.`);
    await mutate([
      "device",
      "select",
      matches[0].id,
      "--expected-generation",
      String(devices.generation),
    ]);
  }
  async function close() {
    const errors = {};
    if (app?.pid && app.exitCode === null && app.signalCode === null) {
      try {
        await execute("taskkill", ["/PID", String(app.pid), "/T", "/F"], { windowsHide: true });
      } catch (error) {
        errors.workbenchStopError = error.message;
      }
    }
    try {
      await server?.close();
    } catch (error) {
      errors.serverStopError = error.message;
    }
    return errors;
  }

  const handle = {
    call,
    mutate,
    patch,
    screenshot,
    windowEnvironment,
    dismissStartupSurfaces,
    selectInput,
    close,
    get app() {
      return app;
    },
  };
  try {
    await checkNativeBuild();
    report.commit = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: ROOT,
      encoding: "utf8",
      windowsHide: true,
    }).trim();
    report.nativeBinarySha256 = sha256(await readFile(appPath));
    let existing;
    try {
      existing = await fetch("http://localhost:1420/", { signal: AbortSignal.timeout(2000) });
    } catch {
      /* Start our own server below. */
    }
    if (existing)
      throw new Error(
        "Port 1420 is occupied. Stop its development server before capture; the recipe starts its own server with hot reload disabled."
      );
    const { createServer } = await import("vite");
    server = await createServer({
      root: ROOT,
      configFile: join(ROOT, "vite.config.js"),
      // Match the desktop launcher: plain Vite otherwise selects browser-only adapters.
      define: { "import.meta.env.TAURI_ENV_PLATFORM": JSON.stringify("windows") },
      server: { port: 1420, strictPort: true, watch: { ignored: ["**/*"] }, hmr: false },
      optimizeDeps: { entries: ["index.html"] },
    });
    await server.listen();
    app = spawn(appPath, ["--plvs-test-app-data-root", appData], {
      cwd: ROOT,
      env: { ...process.env, WEBVIEW2_USER_DATA_FOLDER: join(output, "webview-data") },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const log = (data) => {
      report.appLog = (report.appLog ?? "") + data.toString();
    };
    app.stdout.on("data", log);
    app.stderr.on("data", log);
    let launchError;
    app.on("error", (error) => {
      launchError = error;
    });
    const deadline = Date.now() + 45000;
    while (!instanceId) {
      signal?.throwIfAborted();
      if (launchError || app.exitCode !== null || Date.now() > deadline)
        throw new Error(
          `Isolated workbench did not become ready (exit ${app.exitCode}). ${launchError?.message ?? ""} ${report.appLog ?? ""}`
        );
      try {
        const { instances } = await call(["instances"], false);
        if (instances.length === 1) {
          instanceId = instances[0].instanceId;
          await call(["inspect"]);
        }
      } catch {
        instanceId = undefined;
      }
      if (!instanceId) await delay(500, undefined, { signal });
    }
    report.instanceId = instanceId;
    const capabilities = await call(["capabilities"]);
    const packageVersion = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8")).version;
    report.appVersion = capabilities.appVersion;
    if (
      capabilities.runtime?.identifier !== "com.soundoer.plvs.dev" ||
      capabilities.appVersion !== packageVersion
    )
      throw new Error("Dev app identity/version does not match this checkout.");
    for (const method of REQUIRED_METHODS)
      if (!capabilities.methods.includes(method)) throw new Error(`Missing capability ${method}`);
    const doctor = await call(["doctor"], false);
    if (doctor.report.checks.find((c) => c.id === "device-enumeration")?.status !== "ok")
      throw new Error("Audio device enumeration failed.");
    // The first-run surface blocks Dock and scene operations, so it goes before anything else.
    report.dismissedSurfaces = await dismissStartupSurfaces();
    await mutate(["theme", "select", recipe.startup.themeId]);
    // Initial device discovery and window hydration can advance the revision after inspect.
    await delay(2000, undefined, { signal });
    return handle;
  } catch (error) {
    Object.assign(report.cleanup ?? (report.cleanup = {}), await close());
    throw error;
  }
}
