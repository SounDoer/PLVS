#!/usr/bin/env node
import { mkdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createSharesetsPreviewBrowserRuntime } from "./generate-sharesets-previews.mjs";
import { SHARESETS_PREVIEW_MULTICHANNEL_V1 } from "../src/transfer/fixtures/sharesetsPreviewMultichannelV1.js";
import { BUILTIN_THEMES_V2 } from "../src/theme/builtinThemesV2.js";
import { themeToPortable } from "../src/theme/portableTheme.js";
import { buildSharesetsThemePreviewPlan } from "../src/theme/sharesetsThemePreview.js";

const ASSETS = Object.freeze([
  Object.freeze({
    id: "multichannel-preset-1280x800",
    renderer: "multichannel-monitoring-prototype",
    surface: "preset",
    format: "png",
    viewport: { widthCssPx: 1280, heightCssPx: 800, deviceScaleFactor: 1 },
  }),
  Object.freeze({
    id: "multichannel-theme-1280x800",
    renderer: "multichannel-monitoring-prototype",
    surface: "theme",
    format: "png",
    viewport: { widthCssPx: 1280, heightCssPx: 800, deviceScaleFactor: 1 },
  }),
]);

export async function buildMultichannelMonitoringPrototypePlan(themeId) {
  const theme = BUILTIN_THEMES_V2[themeId];
  if (!theme) throw new Error(`Unknown built-in Theme: ${themeId}.`);
  const plan = await buildSharesetsThemePreviewPlan({ theme: themeToPortable(theme) });
  return {
    ...plan,
    multichannelFixture: structuredClone(SHARESETS_PREVIEW_MULTICHANNEL_V1),
    assets: ASSETS.map((asset) => ({ ...asset })),
  };
}

export async function generateMultichannelMonitoringPrototype({ outputDirectory }) {
  const output = resolve(outputDirectory);
  try {
    await stat(output);
    throw new Error("The prototype output directory must not already exist.");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  await mkdir(output, { recursive: true });
  const runtime = await createSharesetsPreviewBrowserRuntime();
  try {
    for (const themeId of ["plvs-dark", "plvs-light"]) {
      const plan = await buildMultichannelMonitoringPrototypePlan(themeId);
      const themeOutput = join(output, themeId);
      await mkdir(themeOutput);
      for (const asset of plan.assets) {
        await runtime.capture({
          plan,
          asset,
          path: join(themeOutput, `${asset.id}.png`),
        });
      }
    }
  } finally {
    await runtime.close();
  }
  return { outputDirectory: output, themes: ["plvs-dark", "plvs-light"], assets: ASSETS };
}

async function main(args) {
  if (args.length !== 1) {
    throw new Error("Usage: npm run sharesets:multichannel-prototype -- <new-output-directory>");
  }
  const result = await generateMultichannelMonitoringPrototype({ outputDirectory: args[0] });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  });
}
