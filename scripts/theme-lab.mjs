#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import process from "node:process";
import sharp from "sharp";
import { analyzeThemeVisuals } from "../src/theme/themeVisualAnalysis.js";
import { buildCommunityThemePreviewPlan } from "../src/theme/communityThemePreview.js";
import {
  createCommunityPreviewBrowserRuntime,
  prepareCommunityPreviewOutput,
} from "./generate-community-previews.mjs";
import { buildThemeLabVariants } from "./theme-lab-lib.mjs";

function parseArgs(args) {
  let manifest;
  let outDir;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--manifest" && args[index + 1]) manifest = args[(index += 1)];
    else if (args[index] === "--out-dir" && args[index + 1]) outDir = args[(index += 1)];
    else {
      throw new Error(
        "Usage: npm run theme:lab -- --manifest <experiments.json> [--out-dir <new-directory>]"
      );
    }
  }
  if (!manifest) throw new Error("--manifest is required.");
  const stamp = new Date()
    .toISOString()
    .replaceAll(":", "-")
    .replace(/\.\d{3}Z$/, "Z");
  return {
    manifestPath: resolve(manifest),
    outputDirectory: resolve(outDir ?? join("artifacts", "theme-lab", stamp)),
  };
}

async function createComparisonSheet(entries, path) {
  const cellWidth = 480;
  const imageHeight = 300;
  const labelHeight = 38;
  const gap = 14;
  const columns = Math.min(3, entries.length);
  const rows = Math.ceil(entries.length / columns);
  const cells = await Promise.all(
    entries.map(async ({ id, name, imagePath }) => {
      const image = await sharp(imagePath)
        .resize({ width: cellWidth, height: imageHeight, fit: "contain", background: "#111111" })
        .extend({ top: labelHeight, background: "#111111" })
        .composite([
          {
            input: Buffer.from(
              `<svg width="${cellWidth}" height="${labelHeight}"><text x="12" y="25" fill="#f4f4f5" font-family="Segoe UI" font-size="15">${escapeXml(name)} · ${escapeXml(id)}</text></svg>`
            ),
            left: 0,
            top: 0,
          },
        ])
        .png()
        .toBuffer();
      return image;
    })
  );
  await sharp({
    create: {
      width: columns * cellWidth + (columns + 1) * gap,
      height: rows * (imageHeight + labelHeight) + (rows + 1) * gap,
      channels: 4,
      background: "#202020",
    },
  })
    .composite(
      cells.map((input, index) => ({
        input,
        left: gap + (index % columns) * (cellWidth + gap),
        top: gap + Math.floor(index / columns) * (imageHeight + labelHeight + gap),
      }))
    )
    .png()
    .toFile(path);
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export async function runThemeLab({
  manifestPath,
  outputDirectory,
  createRuntime = createCommunityPreviewBrowserRuntime,
}) {
  const manifestText = await readFile(manifestPath, "utf8");
  const manifest = JSON.parse(manifestText);
  const variants = await buildThemeLabVariants(manifest, manifestPath);
  await mkdir(resolve(outputDirectory, ".."), { recursive: true });
  const { output, staging } = await prepareCommunityPreviewOutput(manifestPath, outputDirectory);
  let runtime;
  try {
    runtime = await createRuntime();
    const report = {
      version: 1,
      manifest: basename(manifestPath),
      manifestSha256: createHash("sha256").update(manifestText).digest("hex"),
      renderer: "community-theme-preview",
      variants: [],
      comparisons: [],
    };
    const imagesByAsset = new Map();
    for (const variant of variants) {
      const directory = join(staging, variant.id);
      await mkdir(directory);
      await writeFile(
        join(directory, "theme.json"),
        `${JSON.stringify(variant.portable, null, 2)}\n`
      );
      const plan = await buildCommunityThemePreviewPlan({ theme: variant.portable });
      const assets = [];
      for (const asset of plan.assets) {
        const imagePath = join(directory, `${asset.id}.png`);
        await runtime.capture({ plan, asset, path: imagePath });
        const metadata = await sharp(imagePath).metadata();
        const bytes = await readFile(imagePath);
        assets.push({
          id: asset.id,
          path: `${variant.id}/${asset.id}.png`,
          width: metadata.width,
          height: metadata.height,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        });
        const entries = imagesByAsset.get(asset.id) ?? [];
        entries.push({ id: variant.id, name: variant.name, imagePath });
        imagesByAsset.set(asset.id, entries);
      }
      report.variants.push({
        id: variant.id,
        name: variant.name,
        theme: `${variant.id}/theme.json`,
        visualReview: analyzeThemeVisuals(variant.document),
        assets,
      });
    }
    const comparisonDirectory = join(staging, "comparison");
    await mkdir(comparisonDirectory);
    for (const [assetId, entries] of imagesByAsset) {
      const comparisonPath = join(comparisonDirectory, `${assetId}.png`);
      await createComparisonSheet(entries, comparisonPath);
      report.comparisons.push({ id: assetId, path: `comparison/${assetId}.png` });
    }
    await writeFile(join(staging, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
    await runtime.close();
    runtime = null;
    await rename(staging, output);
    return { outputDirectory: output, report };
  } catch (error) {
    await runtime?.close();
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

async function main(args) {
  const result = await runThemeLab(parseArgs(args));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
