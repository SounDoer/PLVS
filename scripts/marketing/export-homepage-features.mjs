// Verify a reviewed feature-image run; --publish copies its originals into the recipe's raw
// directory, from which prepare-homepage-assets.mjs encodes website/assets/homepage/.
import process from "node:process";
import { readFile, writeFile, copyFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import sharp from "sharp";
import { ROOT, contained, sha256 } from "./hero-lib.mjs";
import {
  FEATURES_RECIPE,
  parseExportArgs,
  loadRecipeFile,
  validateFeaturesRecipe,
} from "./homepage-lib.mjs";

const { run: runArg, publish } = parseExportArgs(process.argv.slice(2));
const run = contained(join(ROOT, "artifacts/marketing"), resolve(runArg));
const report = JSON.parse(await readFile(join(run, "capture-report.json"), "utf8"));
const recipe = await loadRecipeFile(FEATURES_RECIPE, validateFeaturesRecipe);
if (report.status !== "reviewRequired" || !isDeepStrictEqual(report.recipe, recipe))
  throw new Error("Run is incomplete, failed, or uses a different recipe.");
const images = [...recipe.multichannel.images, ...recipe.live.scenes.flatMap((s) => s.images)];
for (const image of images) {
  const capture = report.captures.find((c) => c.name === image.name);
  if (!capture) throw new Error(`Run has no ${image.name} capture.`);
  const png = await readFile(join(run, `${image.name}.png`));
  if (sha256(png) !== capture.sha256) throw new Error(`${image.name} changed after capture.`);
  const { width, height } = await sharp(png).metadata();
  if (width !== image.width || height !== image.height)
    throw new Error(
      `${image.name} is ${width}x${height}, expected ${image.width}x${image.height}.`
    );
}
if (!publish) {
  console.log(`Verified ${images.length} feature images in ${run}. Website unchanged.`);
} else {
  const raw = contained(ROOT, recipe.publication.rawDirectory);
  for (const image of images) {
    await copyFile(join(run, `${image.name}.png`), join(raw, `${image.name}.png`));
    await copyFile(join(run, `${image.name}.json`), join(raw, `${image.name}.json`));
  }
  const provenancePath = join(raw, "provenance.json");
  const provenance = JSON.parse(await readFile(provenancePath, "utf8"));
  Object.assign(provenance, {
    capturedAt: report.startedAt,
    appVersion: report.appVersion,
    commit: report.commit,
    recipe: FEATURES_RECIPE,
  });
  await writeFile(provenancePath, JSON.stringify(provenance, null, 2) + "\n");
  console.log(
    `Copied the originals into ${recipe.publication.rawDirectory}. Run node scripts/marketing/prepare-homepage-assets.mjs, then review the diff.`
  );
}
