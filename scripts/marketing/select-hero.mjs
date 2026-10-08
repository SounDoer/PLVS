// Export an explicitly reviewed candidate; publishing is a separate opt-in.
import process from "node:process";
import { readFile, writeFile, copyFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import sharp from "sharp";
import { ROOT, loadRecipe, contained, sha256, verifyAudio, assertGeometry } from "./hero-lib.mjs";

const [runArg, file, ...flags] = process.argv.slice(2);
if (
  !runArg ||
  !file ||
  !flags.includes("--reviewed") ||
  flags.some((f) => !["--reviewed", "--publish"].includes(f))
) {
  throw new Error(
    "Usage: node scripts/marketing/select-hero.mjs <run-directory> <candidate.png> --reviewed [--publish]"
  );
}
const run = contained(join(ROOT, "artifacts/marketing"), resolve(runArg));
const report = JSON.parse(await readFile(join(run, "capture-report.json"), "utf8"));
const recipe = await loadRecipe();
if (report.status !== "reviewRequired" || !isDeepStrictEqual(report.recipe, recipe))
  throw new Error("Run is incomplete, failed, or uses a different recipe.");
verifyAudio(await readFile(contained(ROOT, recipe.audio.path)), recipe);
const candidate = report.captures.find((c) => c.file === file);
if (!candidate?.eligible || candidate.issues.length)
  throw new Error("Only an eligible candidate can be selected.");
const pngPath = contained(run, file);
const png = await readFile(pngPath);
if (sha256(png) !== candidate.sha256) throw new Error("Candidate image changed after capture.");
assertGeometry(candidate.actual, recipe.environment);
const dimensions = await sharp(png).metadata();
if (
  dimensions.width !== recipe.environment.width ||
  dimensions.height !== recipe.environment.height
)
  throw new Error("Candidate dimensions changed.");
const webp = await sharp(png).webp({ lossless: true }).toBuffer();
const [originalPixels, exportedPixels] = await Promise.all([
  sharp(png).ensureAlpha().raw().toBuffer(),
  sharp(webp).ensureAlpha().raw().toBuffer(),
]);
if (!originalPixels.equals(exportedPixels))
  throw new Error("WebP export changed screenshot pixels.");
const metadata = {
  version: 1,
  image: "../landing-hero.webp",
  rawImage: "landing-hero.png",
  width: dimensions.width,
  height: dimensions.height,
  sha256: sha256(webp),
  rawSha256: sha256(png),
  appVersion: report.appVersion,
  recipe: "scripts/marketing/recipes/homepage-hero.json",
  audio: recipe.audio,
  capture: {
    mode: "LIVE",
    layout: "Current First-Run Default",
    second: candidate.second,
    capturedAt: report.startedAt,
    commit: report.commit,
    sourceFingerprint: report.sourceFingerprint,
    nativeBinarySha256: report.nativeBinarySha256,
    geometry: candidate.actual,
    measurement: candidate.result.measurement,
    before: candidate.before,
    after: candidate.after,
  },
  reviewedAt: new Date().toISOString(),
};
await writeFile(join(run, "selected.webp"), webp);
await writeFile(join(run, "selected.json"), JSON.stringify(metadata, null, 2) + "\n");
if (flags.includes("--publish")) {
  const destination = contained(ROOT, recipe.publication.webp);
  if (sha256(await readFile(destination)) !== report.baselineSha256)
    throw new Error(
      "Published hero changed since this run; review against the new baseline before publishing."
    );
  await copyFile(pngPath, contained(ROOT, recipe.publication.png));
  await writeFile(destination, webp);
  await writeFile(
    contained(ROOT, recipe.publication.metadata),
    JSON.stringify(metadata, null, 2) + "\n"
  );
  console.log(
    "Updated the shared website/README hero. Review the three-file diff before committing."
  );
} else {
  console.log(`Exported ${join(run, "selected.webp")}. Published hero unchanged.`);
}
