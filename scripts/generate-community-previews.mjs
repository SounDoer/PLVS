#!/usr/bin/env node
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, lstat, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import sharp from "sharp";
import { build } from "vite";
import {
  buildCommunityPreviewPlan,
  buildCommunityThemePreviewPlan,
  COMMUNITY_PREVIEW_RESULT_VERSION,
  validateCommunityArtifactText,
  validateCommunityPreviewResult,
} from "../src/transfer/communityContract.js";
import { validatePublishablePack } from "../src/transfer/communityPack.js";

const MIME_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".woff2", "font/woff2"],
]);

function inside(parent, child) {
  const path = relative(parent, child);
  return (
    path !== "" &&
    path !== ".." &&
    !path.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) &&
    !isAbsolute(path)
  );
}

async function readCanonicalArtifact(path) {
  const bytes = await readFile(path);
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (_) {
    throw new Error("Community artifacts must be valid UTF-8 text.");
  }
  const validation = await validateCommunityArtifactText(text, { fileName: basename(path) });
  return { rawPack: JSON.parse(text), validation };
}

export async function buildPreviewPlanForArtifact(path) {
  const artifactPath = resolve(path);
  const { rawPack, validation } = await readCanonicalArtifact(artifactPath);
  const plan =
    validation.type === "themes"
      ? await buildCommunityThemePreviewPlan({
          theme: validatePublishablePack(rawPack, "themes").portableItem,
        })
      : await buildCommunityPreviewPlan(rawPack, validation.type);
  return { artifactPath, type: validation.type, plan };
}

export async function prepareCommunityPreviewOutput(artifactPath, outputDirectory) {
  const source = resolve(artifactPath);
  const output = resolve(outputDirectory);
  if (source === output) throw new Error("The preview output cannot replace the source artifact.");
  const parent = dirname(output);
  let parentInfo;
  try {
    parentInfo = await stat(parent);
  } catch (_) {
    throw new Error("The preview output parent directory must already exist.");
  }
  if (!parentInfo.isDirectory()) throw new Error("The preview output parent must be a directory.");
  if ((await lstat(parent)).isSymbolicLink()) {
    throw new Error("The preview output parent cannot be reached through a symbolic link.");
  }
  try {
    await stat(output);
    throw new Error("The preview output directory must not already exist.");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const staging = await mkdtemp(join(parent, ".plvs-community-preview-"));
  if (!inside(parent, staging))
    throw new Error("The preview staging directory escaped its parent.");
  return { output, staging };
}

function contentType(path) {
  return MIME_TYPES.get(extname(path).toLowerCase()) ?? "application/octet-stream";
}

async function startStaticServer(root) {
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const requested = url.pathname === "/" ? "/community-preview.html" : url.pathname;
      const path = resolve(root, `.${decodeURIComponent(requested)}`);
      if (!inside(root, path)) {
        response.writeHead(403).end();
        return;
      }
      const bytes = await readFile(path);
      response.writeHead(200, { "content-type": contentType(path), "cache-control": "no-store" });
      response.end(bytes);
    } catch (error) {
      response.writeHead(error?.code === "ENOENT" ? 404 : 500).end();
    }
  });
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}/community-preview.html`,
    close: () =>
      new Promise((resolveClose, reject) =>
        server.close((error) => (error ? reject(error) : resolveClose()))
      ),
  };
}

export async function createCommunityPreviewBrowserRuntime() {
  const runtimeRoot = await mkdtemp(join(tmpdir(), "plvs-community-render-"));
  const site = join(runtimeRoot, "site");
  let server;
  let browser;
  try {
    await build({
      configFile: resolve("vite.config.js"),
      logLevel: "silent",
      build: { outDir: site, emptyOutDir: true },
    });
    server = await startStaticServer(site);
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      locale: "en-US",
      colorScheme: "dark",
      deviceScaleFactor: 1,
      reducedMotion: "reduce",
    });
    return {
      async capture({ plan, asset, path }) {
        const viewport = asset.viewport;
        if (
          !viewport ||
          viewport.deviceScaleFactor !== 1 ||
          !Number.isSafeInteger(viewport.widthCssPx) ||
          !Number.isSafeInteger(viewport.heightCssPx)
        ) {
          throw new Error(`Preview asset ${asset.id} has an unsupported viewport.`);
        }
        const page = await context.newPage();
        const pageErrors = [];
        try {
          page.on("pageerror", (error) => pageErrors.push(error));
          await page.route("**/*", (route) => {
            const url = new URL(route.request().url());
            return url.hostname === "127.0.0.1" ? route.continue() : route.abort("blockedbyclient");
          });
          await page.setViewportSize({ width: viewport.widthCssPx, height: viewport.heightCssPx });
          await page.goto(server.url, { waitUntil: "load" });
          const settlement = await page.evaluate(
            ({ renderPlan, assetId }) =>
              window.__PLVS_COMMUNITY_PREVIEW__.render(renderPlan, assetId),
            { renderPlan: plan, assetId: asset.id }
          );
          if (pageErrors.length > 0) throw pageErrors[0];
          if (settlement?.ready !== true)
            throw new Error(`Preview asset ${asset.id} did not settle.`);
          await page.screenshot({ path, type: "png", animations: "disabled", caret: "hide" });
        } finally {
          await page.close();
        }
      },
      async close() {
        await context.close();
        await browser.close();
        await server.close();
        await rm(runtimeRoot, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await browser?.close();
    await server?.close();
    await rm(runtimeRoot, { recursive: true, force: true });
    throw error;
  }
}

function rendererIdentity(plan) {
  return plan.renderer
    ? { name: plan.renderer.name, version: plan.renderer.version }
    : { name: plan.generator, version: plan.contractVersion };
}

function contentIdentity(plan) {
  return plan.item?.contentHash ?? plan.theme?.contentHash;
}

export async function generateCommunityPreviews({
  artifactPath,
  outputDirectory,
  createRuntime = createCommunityPreviewBrowserRuntime,
}) {
  const source = resolve(artifactPath);
  const { output, staging } = await prepareCommunityPreviewOutput(source, outputDirectory);
  let runtime;
  try {
    const { plan, type } = await buildPreviewPlanForArtifact(source);
    runtime = await createRuntime();
    const assets = [];
    for (const asset of plan.assets) {
      const path = join(staging, `${asset.id}.png`);
      await runtime.capture({ plan, asset, path });
      const bytes = await readFile(path);
      const metadata = await sharp(bytes).metadata();
      assets.push({
        id: asset.id,
        path: `${asset.id}.png`,
        mediaType: "image/png",
        width: metadata.width,
        height: metadata.height,
        byteLength: bytes.byteLength,
        sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
        source: asset.source,
      });
    }
    const report = validateCommunityPreviewResult(plan, {
      resultVersion: COMMUNITY_PREVIEW_RESULT_VERSION,
      renderer: rendererIdentity(plan),
      contentHash: contentIdentity(plan),
      fixtureHash: plan.fixtureHash,
      assets,
    });
    await writeFile(join(staging, "preview-result.json"), `${JSON.stringify(report, null, 2)}\n`);
    const names = (await readdir(staging)).sort();
    const expected = [...plan.assets.map(({ id }) => `${id}.png`), "preview-result.json"].sort();
    if (JSON.stringify(names) !== JSON.stringify(expected)) {
      throw new Error("The generated preview directory contains an unexpected file set.");
    }
    await runtime.close();
    runtime = null;
    await rename(staging, output);
    return { type, outputDirectory: output, report };
  } catch (error) {
    await runtime?.close();
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

async function main(args) {
  if (args.length !== 2) {
    throw new Error(
      "Usage: npm run community:preview -- <artifact.plvsloudness|plvspreset|plvstheme> <new-output-directory>"
    );
  }
  const result = await generateCommunityPreviews({
    artifactPath: args[0],
    outputDirectory: args[1],
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
