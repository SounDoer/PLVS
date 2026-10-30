#!/usr/bin/env node
// Publish a reviewed render-homepage-images.mjs run into website/. Refuses a run rendered from a
// dirty worktree, with another recipe, with page errors or wrong sizes, whose PNGs changed since
// rendering, or whose published originals changed since rendering. Then encodes the feature images
// with prepare-homepage-assets.mjs.
//   node scripts/marketing/publish-homepage-images.mjs artifacts/marketing/homepage-render-<stamp>
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import sharp from "sharp";
import { publicationTarget } from "./homepage-render-lib.mjs";

const ROOT = resolve(import.meta.dirname, "..", "..");
const RECIPE = join(ROOT, "scripts", "marketing", "recipes", "homepage-images.json");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function inside(parent, child) {
  const path = relative(parent, child);
  return path !== "" && !path.startsWith("..") && !isAbsolute(path);
}

const runArg = process.argv[2];
if (!runArg || process.argv.length > 3) {
  console.error("Usage: node scripts/marketing/publish-homepage-images.mjs <render-run-directory>");
  process.exit(2);
}
const run = resolve(runArg);
if (!inside(join(ROOT, "artifacts", "marketing"), run)) {
  throw new Error("The run must be a directory under artifacts/marketing.");
}
const report = JSON.parse(await readFile(join(run, "report.json"), "utf8"));
const recipeBytes = await readFile(RECIPE);
const recipe = JSON.parse(recipeBytes.toString("utf8"));

const problems = [];
if (!report.worktreeClean) problems.push("the run was rendered from a worktree with changes");
if (report.recipeSha256 !== sha256(recipeBytes)) problems.push("the recipe changed since the run");
const names = new Set(report.images.map(({ name }) => name));
for (const image of recipe.images) {
  if (!names.has(image.name)) problems.push(`the run has no ${image.name}`);
}
const entries = [];
for (const entry of report.images) {
  const png = await readFile(join(run, entry.file));
  if (sha256(png) !== entry.sha256) problems.push(`${entry.name} changed after rendering`);
  if (!entry.sizeMatches) problems.push(`${entry.name} is not its published size`);
  if (entry.errors.length > 0) problems.push(`${entry.name} rendered with page errors`);
  const target = publicationTarget(recipe, entry.name);
  const current = await readFile(join(ROOT, target.png)).catch(() => null);
  if ((current ? sha256(current) : null) !== entry.originalSha256) {
    problems.push(`${target.png} changed since the run; render again and review`);
  }
  entries.push({ entry, png, target });
}
if (problems.length > 0) throw new Error(`Not publishing:\n- ${problems.join("\n- ")}`);

const provenance = {
  version: 2,
  method:
    "Rendered by scripts/marketing/render-homepage-images.mjs: the app's own panels fed by committed fixtures that the production meter pipeline measured offline, in headless Chromium.",
  renderedAt: report.renderedAt,
  commit: report.commit,
  chromium: report.chromium,
  recipe: "scripts/marketing/recipes/homepage-images.json",
  recipeSha256: report.recipeSha256,
  fixtureSha256: report.fixtureSha256,
};
const features = {};
for (const { entry, png, target } of entries) {
  const image = recipe.images.find(({ name }) => name === entry.name);
  const describe = {
    scene: image.scene,
    fixture: image.fixture,
    interfaceSize: image.interfaceSize ?? "default",
    ...(image.snapshotOffsetSec !== undefined
      ? { snapshotOffsetSec: image.snapshotOffsetSec }
      : {}),
    width: entry.width,
    height: entry.height,
    rawSha256: entry.sha256,
  };
  await mkdir(dirname(join(ROOT, target.png)), { recursive: true });
  await writeFile(join(ROOT, target.png), png);
  if (target.kind === "own") {
    const webp = await sharp(png).webp({ lossless: true }).toBuffer();
    const [decoded, original] = await Promise.all([
      sharp(webp).ensureAlpha().raw().toBuffer(),
      sharp(png).ensureAlpha().raw().toBuffer(),
    ]);
    if (!decoded.equals(original)) throw new Error(`${entry.name}: WebP export changed pixels.`);
    await writeFile(join(ROOT, target.webp), webp);
    const metadata = { ...provenance, image: entry.name, ...describe, sha256: sha256(webp) };
    await writeFile(join(ROOT, target.metadata), `${JSON.stringify(metadata, null, 2)}\n`);
  } else {
    features[entry.name] = describe;
  }
}
await writeFile(
  join(ROOT, recipe.publication.rawDirectory, "provenance.json"),
  `${JSON.stringify({ ...provenance, images: features }, null, 2)}\n`
);
const prepare = spawnSync(process.execPath, ["scripts/marketing/prepare-homepage-assets.mjs"], {
  cwd: ROOT,
  stdio: "inherit",
});
if (prepare.status !== 0) throw new Error("prepare-homepage-assets.mjs failed.");
console.log(
  "Published. Run npm run website:verify and review the homepage at 1440, 820 and 390 px."
);
