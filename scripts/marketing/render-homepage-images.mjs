#!/usr/bin/env node
// Render the homepage images from the committed fixtures with the app's own panels in headless
// Chromium. Writes PNGs, report.json and comparison.html into a new
// artifacts/marketing/homepage-render-<timestamp>/ directory; nothing under website/ changes.
//   node scripts/marketing/render-homepage-images.mjs [--only name,name]
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, relative, resolve } from "node:path";
import { chromium } from "playwright";
import sharp from "sharp";
import { build } from "vite";
import { DEFAULT_PRESET } from "../../src/lib/defaultPreset.js";
import { DEFAULT_LOUDNESS_PROFILE } from "../../src/lib/loudnessProfileCatalog.js";
import { firstRunDockState } from "../../src/dock/firstRunDock.js";
import { BUILTIN_THEMES_V2 } from "../../src/theme/builtinThemesV2.js";
import { themeToPortable } from "../../src/theme/portableTheme.js";
import { buildSharesetsThemePreviewPlan } from "../../src/theme/sharesetsThemePreview.js";
import { buildPack } from "../../src/transfer/packShape.js";
import { buildSharesetsPreviewPlan } from "../../src/transfer/sharesetsPreview.js";
import {
  finalFrameStatuses,
  homepageRecipeProblems,
  imageWorkspace,
  portableDockPanels,
  portableWorkspace,
  publicationTarget,
  statusMismatches,
} from "./homepage-render-lib.mjs";

const ROOT = resolve(import.meta.dirname, "..", "..");
const RECIPE = join(ROOT, "scripts", "marketing", "recipes", "homepage-images.json");
const DOCK_HEIGHT_CSS_PX = 150;

function parseArgs(argv) {
  const onlyIndex = argv.indexOf("--only");
  const only = onlyIndex >= 0 ? new Set((argv[onlyIndex + 1] ?? "").split(",")) : null;
  const unknown = argv.filter((arg, index) => arg !== "--only" && index !== onlyIndex + 1);
  if (unknown.length > 0 || (onlyIndex >= 0 && !argv[onlyIndex + 1])) {
    throw new Error("Usage: node scripts/marketing/render-homepage-images.mjs [--only a,b]");
  }
  return { only };
}

function presetPack() {
  const pack = buildPack("presets", [DEFAULT_PRESET], {
    loudnessProfiles: [DEFAULT_LOUDNESS_PROFILE],
  });
  pack.items[0].id = "homepage";
  return pack;
}

function firstRunDockPortable() {
  const { layout, controlsByPanelId } = firstRunDockState();
  const preset = {
    ...structuredClone(DEFAULT_PRESET),
    dock: {
      enabled: true,
      edge: "top",
      reserveSpace: false,
      height: DOCK_HEIGHT_CSS_PX,
      ...layout,
      controlsByPanelId,
    },
  };
  return buildPack("presets", [preset], { loudnessProfiles: [DEFAULT_LOUDNESS_PROFILE] }).items[0]
    .dock;
}

/** The plan, asset id and starter-or-custom Profile one recipe image renders with. */
async function planFor(recipe, image, fixtures) {
  const fixture = fixtures[image.fixture];
  if (image.scene === "workspace-shell") {
    const plan = await buildSharesetsThemePreviewPlan({
      theme: themeToPortable(BUILTIN_THEMES_V2[recipe.themeId]),
    });
    return {
      plan: { ...plan, fixture },
      assetId: "product-workspace-file",
      profile: DEFAULT_LOUDNESS_PROFILE,
    };
  }
  const pack = presetPack();
  const item = pack.items[0];
  if (image.loudnessProfile) {
    pack.dependencies[0].items = [
      {
        ...pack.dependencies[0].items[0],
        ...recipe.loudnessProfiles[image.loudnessProfile],
        id: "default",
      },
    ];
  }
  if (image.scene === "dock") {
    const firstRun = firstRunDockPortable();
    const firstRunControls = Object.fromEntries(
      firstRun.panels.map(({ moduleId, controls }) => [moduleId, controls])
    );
    item.dock =
      image.dock === "first-run"
        ? firstRun
        : {
            enabled: true,
            edge: "top",
            reserveSpace: false,
            heightCssPx: DOCK_HEIGHT_CSS_PX,
            panels: portableDockPanels(image.dock.panels, firstRunControls),
          };
  } else {
    const workspace = structuredClone(imageWorkspace(recipe, image));
    if (image.frequencyRangeHz) {
      workspace.axes = {
        ...workspace.axes,
        spectrum: { frequency: { linked: true, ...image.frequencyRangeHz } },
      };
    }
    item.workspace = portableWorkspace(workspace);
  }
  const plan = await buildSharesetsPreviewPlan(pack, "presets");
  const renderer = image.scene === "dock" ? "preset-dock" : "preset-workspace";
  const asset = plan.assets.find(
    (candidate) => candidate.renderer === renderer && !candidate.fixtureKey
  );
  return {
    plan: { ...plan, fixture },
    assetId: asset.id,
    profile: pack.dependencies[0].items[0],
  };
}

const MIME = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".woff2", "font/woff2"],
  [".svg", "image/svg+xml"],
]);

async function startStaticServer(site) {
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const path = resolve(site, `.${decodeURIComponent(url.pathname)}`);
      if (relative(site, path).startsWith("..")) {
        response.writeHead(403).end();
        return;
      }
      const bytes = await readFile(path);
      response.writeHead(200, {
        "content-type": MIME.get(extname(path)) ?? "application/octet-stream",
        "cache-control": "no-store",
      });
      response.end(bytes);
    } catch (error) {
      response.writeHead(error?.code === "ENOENT" ? 404 : 500).end();
    }
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  return {
    url: `http://127.0.0.1:${server.address().port}/homepage-preview.html`,
    close: () => new Promise((done) => server.close(done)),
  };
}

function comparisonHtml(rows) {
  const cells = rows
    .map(
      ({ name, rendered, original, size, note }) => `
  <section>
    <h2>${name} <small>${size}${note ? ` — ${note}` : ""}</small></h2>
    <div class="pair">
      <figure><img src="${rendered}"><figcaption>rendered</figcaption></figure>
      <figure><img src="${original}"><figcaption>published</figcaption></figure>
    </div>
  </section>`
    )
    .join("");
  return `<!doctype html><meta charset="utf-8"><title>Homepage render comparison</title>
<style>body{background:#111;color:#ddd;font:14px system-ui;margin:24px}img{max-width:100%;display:block}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:12px}figure{margin:0}small{color:#888}</style>${cells}`;
}

async function main() {
  const { only } = parseArgs(process.argv.slice(2));
  const recipe = JSON.parse(await readFile(RECIPE, "utf8"));
  const problems = homepageRecipeProblems(recipe);
  if (problems.length > 0) throw new Error(`Recipe problems:\n- ${problems.join("\n- ")}`);
  const fixtures = {};
  const fixtureHashes = {};
  for (const [key, path] of Object.entries(recipe.fixtures)) {
    const text = await readFile(join(ROOT, path), "utf8");
    fixtures[key] = JSON.parse(text);
    fixtureHashes[key] = createHash("sha256").update(text).digest("hex");
  }
  const images = recipe.images.filter((image) => !only || only.has(image.name));

  for (const image of images.filter(({ requiredStatuses }) => requiredStatuses)) {
    const { profile } = await planFor(recipe, image, fixtures);
    const mismatches = statusMismatches(
      finalFrameStatuses(fixtures[image.fixture], profile),
      image.requiredStatuses
    );
    if (mismatches.length > 0) throw new Error(`${image.name}: ${mismatches.join("; ")}.`);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const out = join(ROOT, "artifacts", "marketing", `homepage-render-${stamp}`);
  await mkdir(out, { recursive: true });
  const runtime = await mkdtemp(join(tmpdir(), "plvs-homepage-render-"));
  const site = join(runtime, "site");
  let server;
  let browser;
  const git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
  const report = {
    renderedAt: new Date().toISOString(),
    commit: git("rev-parse", "HEAD"),
    worktreeClean: git("status", "--porcelain") === "",
    recipeSha256: createHash("sha256")
      .update(await readFile(RECIPE))
      .digest("hex"),
    fixtureSha256: fixtureHashes,
    images: [],
  };
  try {
    await build({
      configFile: join(ROOT, "vite.config.js"),
      logLevel: "silent",
      build: {
        outDir: site,
        emptyOutDir: true,
        rollupOptions: { input: { homepagePreview: join(ROOT, "homepage-preview.html") } },
      },
    });
    server = await startStaticServer(site);
    browser = await chromium.launch({ headless: true });
    report.chromium = browser.version();
    const context = await browser.newContext({
      locale: "en-US",
      colorScheme: "dark",
      deviceScaleFactor: recipe.deviceScaleFactor,
      reducedMotion: "reduce",
    });
    for (const image of images) {
      const { plan, assetId, profile } = await planFor(recipe, image, fixtures);
      const fullShell = image.scene === "workspace-shell" || image.shell === true;
      const scene = {
        ...(image.snapshotOffsetSec !== undefined
          ? { snapshotOffsetSec: image.snapshotOffsetSec }
          : {}),
        ...(image.shell ? { fullShell: true } : {}),
        ...(fullShell
          ? {
              elapsedMs: fixtures[image.fixture].source.windowEndMs,
              sourceLabel: recipe.shell.sourceLabel,
              deviceLabel: recipe.shell.deviceLabel,
            }
          : {}),
      };
      const overlay = image.overlay ? { ...image.overlay, profile } : null;
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => message.type() === "error" && errors.push(message.text()));
      await page.route("**/*", (route) =>
        new URL(route.request().url()).hostname === "127.0.0.1"
          ? route.continue()
          : route.abort("blockedbyclient")
      );
      await page.setViewportSize(image.viewport);
      await page.goto(server.url, { waitUntil: "load" });
      await page.waitForFunction(() => window.__PLVS_HOMEPAGE_PREVIEW__);
      const settlement = await page.evaluate(
        (request) => window.__PLVS_HOMEPAGE_PREVIEW__.render(request),
        { plan, assetId, scene, overlay, interfaceSize: image.interfaceSize ?? "default" }
      );
      const options = { type: "png", animations: "disabled", caret: "hide" };
      if (image.crop.type === "rows") {
        options.clip = {
          x: 0,
          y: 0,
          width: image.viewport.width,
          height: image.crop.height / recipe.deviceScaleFactor,
        };
      } else if (image.crop.type === "rect") {
        const { x, y, width, height } = image.crop;
        options.clip = { x, y, width, height };
      } else if (image.crop.type === "panel") {
        const box = await page.evaluate((moduleId) => {
          const element = document.querySelector(`[data-visual-panel-id^="${moduleId}"]`);
          const rect = element?.getBoundingClientRect();
          return rect && { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        }, image.crop.moduleId);
        if (!box) throw new Error(`${image.name}: no ${image.crop.moduleId} panel to crop.`);
        options.clip = box;
      }
      const raw = await page.screenshot(options);
      await page.close();
      const metadata = await sharp(raw).metadata();
      const size = `${metadata.width} × ${metadata.height}`;
      const expected = `${image.output.width} × ${image.output.height}`;
      const note = size === expected ? null : `expected ${expected}`;
      const path = join(out, `${image.name}.png`);
      await writeFile(path, raw);
      const original = await readFile(join(ROOT, publicationTarget(recipe, image.name).png)).catch(
        () => null
      );
      report.images.push({
        name: image.name,
        originalSha256: original ? createHash("sha256").update(original).digest("hex") : null,
        file: `${image.name}.png`,
        width: metadata.width,
        height: metadata.height,
        sizeMatches: note === null,
        sha256: createHash("sha256").update(raw).digest("hex"),
        settlement,
        errors,
      });
      console.log(
        `${image.name}: ${size}${note ? ` (${note})` : ""}${errors.length ? ` errors: ${errors[0]}` : ""}`
      );
    }
    await context.close();
  } finally {
    await browser?.close();
    await server?.close();
    await rm(runtime, { recursive: true, force: true });
  }
  await writeFile(join(out, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(
    join(out, "comparison.html"),
    comparisonHtml(
      report.images.map((entry) => {
        const image = recipe.images.find(({ name }) => name === entry.name);
        return {
          name: entry.name,
          rendered: entry.file,
          original: relative(out, join(ROOT, publicationTarget(recipe, image.name).png)).replaceAll(
            "\\",
            "/"
          ),
          size: `${entry.width} × ${entry.height}`,
          note: entry.sizeMatches
            ? null
            : `expected ${image.output.width} × ${image.output.height}`,
        };
      })
    )
  );
  console.log(`Wrote ${relative(ROOT, out)}`);
  if (report.images.some(({ errors }) => errors.length > 0)) process.exitCode = 1;
}

await main();
