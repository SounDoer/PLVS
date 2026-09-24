#!/usr/bin/env node

import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import process from "node:process";
import sharp from "sharp";
import { buildPlvsCli } from "./build-plvs-cli.mjs";
import {
  createStereoFixtureWav,
  generateSemanticGallery,
  readGalleryManifest,
  repositoryRoot,
  validateGalleryManifest,
} from "./theme-gallery-lib.mjs";

const REQUIRED_PRODUCT_METHODS = [
  "app.capabilities",
  "app.inspect",
  "app.wait",
  "theme.inspect",
  "theme.select",
  "theme.followSystem",
  "view.inspect",
  "view.update",
  "panel.update",
  "axis.shared.update",
  "transport.inspect",
  "transport.source.live",
  "transport.source.file",
  "transport.live.start",
  "transport.file.analyze",
  "transport.file.select",
  "transport.file.remove",
  "visual.screenshot",
];

function parseArgs(args) {
  const options = { semantic: true, product: true, outDir: undefined, manifestPath: undefined };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--semantic-only") options.product = false;
    else if (arg === "--product-only") options.semantic = false;
    else if (arg === "--out-dir" && args[index + 1]) options.outDir = args[(index += 1)];
    else if (arg === "--manifest" && args[index + 1]) options.manifestPath = args[(index += 1)];
    else {
      throw new Error(
        "Usage: node scripts/theme-gallery.mjs [--semantic-only|--product-only] [--manifest <file>] [--out-dir <directory>]"
      );
    }
  }
  const stamp = new Date()
    .toISOString()
    .replaceAll(":", "-")
    .replace(/\.\d{3}Z$/, "Z");
  return {
    ...options,
    outDir: resolve(repositoryRoot, options.outDir ?? join("artifacts", "theme-gallery", stamp)),
    manifestPath: options.manifestPath ? resolve(repositoryRoot, options.manifestPath) : undefined,
  };
}

export function parseJsonEnvelope(label, output) {
  const line = output
    .replace(/^\uFEFF/, "")
    .trim()
    .split(/\r?\n/)
    .pop();
  let envelope;
  try {
    envelope = JSON.parse(line);
  } catch {
    throw new Error(`${label} produced invalid JSON: ${line || "(empty output)"}`);
  }
  if (!envelope || envelope.ok !== true || !envelope.result) {
    const reason = envelope?.error?.details?.reason ?? envelope?.error?.code ?? "unknownError";
    throw new Error(`${label} failed (${reason}): ${envelope?.error?.message ?? "No result."}`);
  }
  return envelope.result;
}

function createCliRunner(executable) {
  return (label, args, { allowFailure = false } = {}) => {
    const result = spawnSync(executable, args, {
      cwd: repositoryRoot,
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
      timeout: 330_000,
    });
    if (result.error) throw new Error(`${label} could not run: ${result.error.message}`);
    if (allowFailure && result.status !== 0) return null;
    const parsed = parseJsonEnvelope(label, result.stdout);
    if (result.status !== 0) throw new Error(`${label} exited with status ${result.status}.`);
    return parsed;
  };
}

function revision(run) {
  return run("inspect", ["inspect", "--json"]).revision;
}

function mutate(run, label, args) {
  return run(label, [...args, "--expected-revision", String(revision(run)), "--json"]);
}

function fileSessions(transport) {
  return transport.files?.sessions ?? transport.fileSessions ?? [];
}

function comparablePath(path) {
  return resolve(String(path ?? "").replace(/^\\\\\?\\/, ""));
}

function sharedAxisRange(app, kind) {
  return app.workspace.panels.find((panel) => panel.axes?.[kind]?.source === "workspace")?.axes?.[
    kind
  ]?.range;
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function waitForFileAnalysis(run, fixturePath, timeoutMs = 120_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const transport = run("transport inspect", ["transport", "inspect", "--json"]);
    const session = fileSessions(transport).find(
      (item) => comparablePath(item.path) === comparablePath(fixturePath)
    );
    if (session?.state === "complete" || session?.state === "completed") return session;
    if (session?.state === "failed")
      throw new Error(`Fixture analysis failed: ${session.error ?? "unknown error"}`);
    run(
      "wait for file analysis",
      ["wait", "--after-revision", String(transport.revision), "--timeout-ms", "5000", "--json"],
      { allowFailure: true }
    );
  }
  throw new Error("Timed out waiting for the deterministic fixture analysis.");
}

async function captureScene({ run, outDir, themeId, scene }) {
  if (scene.axisPatch) {
    const axisPath = join(outDir, ".axis-patch.json");
    await writeFile(axisPath, `${JSON.stringify(scene.axisPatch.range)}\n`, "utf8");
    mutate(run, `axis update ${scene.id}`, [
      "axis",
      "shared",
      "update",
      scene.axisPatch.kind,
      axisPath,
    ]);
  }
  if (scene.panelPatch) {
    const patchPath = join(outDir, ".panel-patch.json");
    await writeFile(patchPath, `${JSON.stringify(scene.panelPatch)}\n`, "utf8");
    mutate(run, `panel update ${scene.id}`, ["panel", "update", scene.panelId, patchPath]);
  }
  const currentRevision = revision(run);
  const path = join(outDir, `${themeId}--${scene.id}.png`);
  const args = ["visual", "screenshot", "--target", scene.target];
  if (scene.panelId) args.push("--panel-id", scene.panelId);
  args.push("--expected-revision", String(currentRevision), "--out", path, "--json");
  const result = run(`capture ${themeId}/${scene.id}`, args);
  const contents = await readFile(path);
  const metadata = await sharp(contents).metadata();
  return {
    id: scene.id,
    themeId,
    state: scene.state,
    target: scene.target,
    panelId: scene.panelId ?? null,
    covers: scene.covers,
    revision: result.revision,
    measurement: result.measurement ?? null,
    path,
    width: metadata.width,
    height: metadata.height,
    bytes: contents.length,
    sha256: createHash("sha256").update(contents).digest("hex"),
    capture: result.artifact,
  };
}

async function createProductContactSheet(captures, outDir) {
  const thumbWidth = 420;
  const gap = 16;
  const cells = [];
  let cellHeight = 0;
  for (const capture of captures) {
    const input = await sharp(capture.path)
      .resize({ width: thumbWidth, height: 300, fit: "contain", background: "#111111" })
      .extend({ top: 34, background: "#111111" })
      .composite([
        {
          input: Buffer.from(
            `<svg width="${thumbWidth}" height="34"><text x="10" y="23" fill="#f4f4f5" font-family="Segoe UI" font-size="15">${capture.themeId} · ${capture.id}</text></svg>`
          ),
          top: 0,
          left: 0,
        },
      ])
      .png()
      .toBuffer();
    const meta = await sharp(input).metadata();
    cellHeight = Math.max(cellHeight, meta.height);
    cells.push(input);
  }
  const columns = 3;
  const rows = Math.ceil(cells.length / columns);
  const contactPath = join(outDir, "product-contact-sheet.png");
  await sharp({
    create: {
      width: columns * thumbWidth + (columns + 1) * gap,
      height: rows * cellHeight + (rows + 1) * gap,
      channels: 4,
      background: "#202020",
    },
  })
    .composite(
      cells.map((input, index) => ({
        input,
        left: gap + (index % columns) * (thumbWidth + gap),
        top: gap + Math.floor(index / columns) * (cellHeight + gap),
      }))
    )
    .png()
    .toFile(contactPath);
  return contactPath;
}

async function runProductGallery({ manifest, outDir, executable }) {
  const productDir = join(outDir, "product");
  await mkdir(productDir, { recursive: true });
  const run = createCliRunner(executable);
  const capabilities = run("capabilities", ["capabilities", "--json"]);
  const missingMethods = REQUIRED_PRODUCT_METHODS.filter(
    (method) => !capabilities.methods.includes(method)
  );
  if (missingMethods.length)
    throw new Error(`Running app is missing required methods: ${missingMethods.join(", ")}.`);

  const initialApp = run("initial inspect", ["inspect", "--json"]);
  const initialTheme = run("initial theme", ["theme", "inspect", "--json"]);
  const initialView = run("initial view", ["view", "inspect", "--json"]);
  const initialTransport = run("initial transport", ["transport", "inspect", "--json"]);
  const initialPanels = new Map(initialApp.workspace.panels.map((panel) => [panel.id, panel]));
  const missingModules = manifest.product.requiredModules.filter(
    (moduleId) => !initialApp.workspace.panels.some((panel) => panel.moduleId === moduleId)
  );
  if (missingModules.length) {
    throw new Error(
      `The current Workspace is missing required gallery modules: ${missingModules.join(", ")}. Reset to the first-run layout and retry.`
    );
  }
  const fixturePath = join(productDir, `${manifest.fixture.id}.wav`);
  const fixture = createStereoFixtureWav(manifest.fixture);
  await writeFile(fixturePath, fixture);
  const fixtureSha256 = createHash("sha256").update(fixture).digest("hex");
  const captures = [];
  let createdSessionId = null;

  try {
    if (initialView.view.surfaceOpacity !== 100) {
      const viewPatchPath = join(productDir, ".opaque-baseline-view.json");
      await writeFile(viewPatchPath, `${JSON.stringify({ surfaceOpacity: 100 })}\n`, "utf8");
      mutate(run, "set opaque gallery baseline", ["view", "update", viewPatchPath]);
    }
    for (const session of fileSessions(initialTransport)) {
      if (comparablePath(session.path) === comparablePath(fixturePath)) {
        mutate(run, "remove prior gallery fixture session", [
          "transport",
          "file",
          "remove",
          session.id,
        ]);
      }
    }
    for (const themeId of manifest.product.themes) {
      mutate(run, `select ${themeId}`, ["theme", "select", themeId]);
      for (const scene of manifest.product.scenes.filter((item) => item.state === "empty")) {
        captures.push(await captureScene({ run, outDir: productDir, themeId, scene }));
      }
    }

    mutate(run, "analyze deterministic fixture", ["transport", "file", "analyze", fixturePath]);
    const session = await waitForFileAnalysis(run, fixturePath);
    createdSessionId = session.id;

    for (const themeId of manifest.product.themes) {
      mutate(run, `select ${themeId}`, ["theme", "select", themeId]);
      for (const scene of manifest.product.scenes.filter((item) => item.state === "file")) {
        captures.push(await captureScene({ run, outDir: productDir, themeId, scene }));
      }
    }
  } finally {
    const spectrogram = initialPanels.get("spectrogram");
    if (spectrogram?.controls) {
      const restorePath = join(productDir, ".restore-spectrogram.json");
      await writeFile(restorePath, `${JSON.stringify(spectrogram.controls)}\n`, "utf8");
      try {
        mutate(run, "restore Spectrogram controls", [
          "panel",
          "update",
          "spectrogram",
          restorePath,
        ]);
      } catch {}
    }
    if (
      createdSessionId &&
      !fileSessions(initialTransport).some(({ id }) => id === createdSessionId)
    ) {
      try {
        mutate(run, "remove fixture session", ["transport", "file", "remove", createdSessionId]);
      } catch {}
    }
    try {
      if (initialTransport.source === "live") {
        mutate(run, "restore Live source", ["transport", "source", "live"]);
        if (initialTransport.live?.state === "running") {
          mutate(run, "restore Live running state", ["transport", "live", "start"]);
        }
      } else if (initialTransport.files?.activeId) {
        mutate(run, "restore selected File session", [
          "transport",
          "file",
          "select",
          initialTransport.files.activeId,
        ]);
      } else {
        mutate(run, "restore File source", ["transport", "source", "file"]);
      }
    } catch {}
    for (const kind of ["frequency", "time"]) {
      const range = sharedAxisRange(initialApp, kind);
      if (!range) continue;
      const restorePath = join(productDir, `.restore-${kind}-axis.json`);
      await writeFile(restorePath, `${JSON.stringify(range)}\n`, "utf8");
      try {
        mutate(run, `restore ${kind} axis`, ["axis", "shared", "update", kind, restorePath]);
      } catch {}
    }
    try {
      if (initialTheme.appearance.mode === "system")
        mutate(run, "restore system theme", ["theme", "follow-system"]);
      else
        mutate(run, "restore fixed theme", [
          "theme",
          "select",
          initialTheme.appearance.selectedThemeId,
        ]);
    } catch {}
    if (initialView.view.surfaceOpacity !== 100) {
      const restoreViewPath = join(productDir, ".restore-view.json");
      await writeFile(
        restoreViewPath,
        `${JSON.stringify({ surfaceOpacity: initialView.view.surfaceOpacity })}\n`,
        "utf8"
      );
      try {
        mutate(run, "restore Surface Opacity", ["view", "update", restoreViewPath]);
      } catch {}
    }
  }

  const restoredApp = run("restored inspect", ["inspect", "--json"]);
  const restoredTheme = run("restored theme", ["theme", "inspect", "--json"]);
  const restoredView = run("restored view", ["view", "inspect", "--json"]);
  const restoredTransport = run("restored transport", ["transport", "inspect", "--json"]);
  const restorationIssues = [];
  if (!sameJson(restoredTheme.appearance, initialTheme.appearance)) {
    restorationIssues.push("Theme appearance");
  }
  if (restoredView.view.surfaceOpacity !== initialView.view.surfaceOpacity) {
    restorationIssues.push("Surface Opacity");
  }
  if (restoredTransport.source !== initialTransport.source) restorationIssues.push("source mode");
  if (restoredTransport.live?.state !== initialTransport.live?.state) {
    restorationIssues.push("Live lifecycle");
  }
  if (
    !sameJson(
      fileSessions(restoredTransport).map(({ id }) => id),
      fileSessions(initialTransport).map(({ id }) => id)
    )
  ) {
    restorationIssues.push("File sessions");
  }
  if (
    !sameJson(
      restoredApp.workspace.panels.find(({ id }) => id === "spectrogram")?.controls,
      initialPanels.get("spectrogram")?.controls
    )
  ) {
    restorationIssues.push("Spectrogram controls");
  }
  for (const kind of ["frequency", "time"]) {
    if (!sameJson(sharedAxisRange(restoredApp, kind), sharedAxisRange(initialApp, kind))) {
      restorationIssues.push(`${kind} axis`);
    }
  }
  if (restorationIssues.length) {
    throw new Error(`Gallery cleanup did not restore: ${restorationIssues.join(", ")}.`);
  }

  const contactPath = await createProductContactSheet(captures, productDir);
  return {
    platform: process.platform,
    runtime: capabilities.runtime,
    fixture: { ...manifest.fixture, path: fixturePath, sha256: fixtureSha256 },
    compositor: { mode: "opaque-baseline", surfaceOpacity: 100 },
    initialRevision: initialApp.revision,
    captures,
    contactPath,
    restoration: { verified: true, revision: restoredApp.revision },
    focusedMatrix: manifest.product.focusedMatrix,
  };
}

export async function runThemeGallery(options) {
  const manifest = await readGalleryManifest(options.manifestPath);
  const issues = validateGalleryManifest(manifest);
  if (issues.length) throw new Error(`Invalid Theme Gallery manifest:\n- ${issues.join("\n- ")}`);
  await mkdir(options.outDir, { recursive: true });
  const result = {
    ok: true,
    manifestVersion: manifest.version,
    generatedAt: new Date().toISOString(),
    commit: spawnSync("git", ["rev-parse", "HEAD"], {
      cwd: repositoryRoot,
      encoding: "utf8",
    }).stdout.trim(),
    platform: process.platform,
  };
  if (options.semantic)
    result.semantic = await generateSemanticGallery({ manifest, outDir: options.outDir });
  if (options.product) {
    const { executable } = buildPlvsCli({ identity: "development" });
    result.product = await runProductGallery({ manifest, outDir: options.outDir, executable });
  }
  const reportPath = join(options.outDir, "report.json");
  await writeFile(reportPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  return { result, reportPath };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const { result, reportPath } = await runThemeGallery(options);
  console.log("OK Theme Gallery generated.");
  if (result.semantic) console.log(`Semantic: ${result.semantic.contactPath}`);
  if (result.product) console.log(`Product : ${result.product.contactPath}`);
  console.log(`Report  : ${reportPath}`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    console.error(`Theme Gallery failed: ${error.message}`);
    console.error(
      "For Product Gallery, start the development app with `npm run desktop` and enable Agent Control."
    );
    process.exitCode = 1;
  });
}
