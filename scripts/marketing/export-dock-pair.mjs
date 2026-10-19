// Export a reviewed Dock run as lossless WebP plus provenance; publishing is a separate opt-in.
import process from "node:process";
import { readFile, writeFile, copyFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import sharp from "sharp";
import { ROOT, contained, sha256, verifyAudio, assertGeometry } from "./hero-lib.mjs";
import {
  DOCK_RECIPE,
  parseExportArgs,
  loadRecipeFile,
  validateDockRecipe,
} from "./homepage-lib.mjs";

const { run: runArg, publish } = parseExportArgs(process.argv.slice(2));
const run = contained(join(ROOT, "artifacts/marketing"), resolve(runArg));
const report = JSON.parse(await readFile(join(run, "capture-report.json"), "utf8"));
const recipe = await loadRecipeFile(DOCK_RECIPE, validateDockRecipe);
if (report.status !== "reviewRequired" || !isDeepStrictEqual(report.recipe, recipe))
  throw new Error("Run is incomplete, failed, or uses a different recipe.");
verifyAudio(await readFile(contained(ROOT, recipe.audio.path)), recipe);
const exports = [];
for (const strip of recipe.strips) {
  const capture = report.captures.find((c) => c.name === strip.name);
  if (!capture) throw new Error(`Run has no ${strip.name} capture.`);
  const pngPath = join(run, `${strip.name}.png`);
  const png = await readFile(pngPath);
  if (sha256(png) !== capture.sha256) throw new Error(`${strip.name} changed after capture.`);
  assertGeometry(capture.actual, recipe.environment);
  const webp = await sharp(png).webp({ lossless: true }).toBuffer();
  const [original, exported] = await Promise.all([
    sharp(png).ensureAlpha().raw().toBuffer(),
    sharp(webp).ensureAlpha().raw().toBuffer(),
  ]);
  if (!original.equals(exported)) throw new Error("WebP export changed screenshot pixels.");
  const metadata = {
    version: 1,
    capturedAt: report.startedAt,
    commit: report.commit,
    appVersion: report.appVersion,
    nativeBinarySha256: report.nativeBinarySha256,
    recipe: DOCK_RECIPE,
    strip: strip.name,
    transport: strip.transport,
    sourceAudio: recipe.audio.path,
    sha256: sha256(webp),
    rawSha256: capture.sha256,
    width: capture.actual.width,
    height: capture.actual.height,
    geometry: capture.actual,
    state: capture.state,
    ui: capture.ui,
    capture: capture.capture,
    reviewedAt: new Date().toISOString(),
  };
  await writeFile(join(run, `${strip.name}.webp`), webp);
  await writeFile(
    join(run, `${strip.name}.metadata.json`),
    JSON.stringify(metadata, null, 2) + "\n"
  );
  exports.push({ strip, pngPath, webp, metadata });
}
if (publish) {
  for (const { strip } of exports) {
    const destination = contained(ROOT, recipe.publication[strip.name].webp);
    if (sha256(await readFile(destination)) !== report.baselineSha256[strip.name])
      throw new Error(
        `${destination} changed since this run; review against the new baseline before publishing.`
      );
  }
  const htmlPath = contained(ROOT, recipe.publication.html);
  let html = await readFile(htmlPath, "utf8");
  for (const { strip, pngPath, webp, metadata } of exports) {
    const target = recipe.publication[strip.name];
    await copyFile(pngPath, contained(ROOT, target.png));
    await writeFile(contained(ROOT, target.webp), webp);
    await writeFile(contained(ROOT, target.metadata), JSON.stringify(metadata, null, 2) + "\n");
    const src = target.webp.replace(/^website\//, "").replace(/[.]/g, "\\.");
    const pattern = new RegExp(`(src="${src}"[\\s\\S]*?width=")\\d+("\\s+height=")\\d+`);
    if (!pattern.test(html)) throw new Error(`${recipe.publication.html} does not show ${src}.`);
    html = html.replace(pattern, (_, a, b) => a + metadata.width + b + metadata.height);
  }
  await writeFile(htmlPath, html);
  console.log("Published the Dock pair. Run review-dock-pair.mjs, then review the diff.");
} else {
  console.log(`Exported the Dock pair inside ${run}. Website unchanged.`);
}
