import { execFileSync } from "node:child_process";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { readPrivacyPolicy, validatePrivacyReview } from "./privacy-review.mjs";
import { releaseAssetNames } from "./release-assets.mjs";

function sourceRevision(root) {
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  if (
    git("rev-parse", "--show-prefix") ||
    git("status", "--porcelain", "--untracked-files=normal")
  ) {
    throw new Error("Website inputs require a clean checkout at its repository root: " + root);
  }
  return git("rev-parse", "HEAD");
}

const importProduct = (root, file) => import(pathToFileURL(join(root, file)).href);
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));

function profileView(profile) {
  if (!profile) return null;
  const { name, referenceLufs, rules } = profile;
  return { name, referenceLufs, rules };
}

function presetView(pack) {
  if (!pack) return null;
  const preset = pack.items[0];
  const { enabled, panels: dockPanels, ...dockSettings } = preset.dock;
  const profileId = preset.loudnessProfile?.dependencyId;
  const profile = profileId
    ? (pack.dependencies ?? [])
        .flatMap(({ items }) => items ?? [])
        .find(({ id }) => id === profileId)
    : null;
  const panelView = (
    { moduleId, title, controls, axes, pinnedSize, preferredWidthCssPx },
    location
  ) => ({
    moduleId,
    title,
    controls,
    axes,
    pinnedSize,
    preferredWidthCssPx,
    location,
  });
  return {
    presentation: preset.presentation,
    dockSettings: enabled ? dockSettings : null,
    profile: profileView(profile),
    panels: [
      ...preset.workspace.panels.map((panel) => panelView(panel, "")),
      ...(enabled ? dockPanels.map((panel) => panelView(panel, "Dock")) : []),
    ],
  };
}

export async function writeCatalogueInputs({
  product,
  catalogueDirectory,
  output,
  review = false,
}) {
  const [{ readSharesetsSource }, { sharesetsAppRequirement }, { MODULE_CATALOG }, { STATS_META }] =
    await Promise.all([
      importProduct(product, "scripts/sharesets-catalogue-source.mjs"),
      importProduct(product, "scripts/sharesets-app-compatibility.mjs"),
      importProduct(product, "src/workspace/moduleCatalog.js"),
      importProduct(product, "src/lib/statsCatalog.js"),
    ]);

  const catalogue = await readSharesetsSource(catalogueDirectory);
  const listings = [];
  const files = new Set();
  for (const { document } of catalogue.listings) {
    const releases = document.releases;
    const current = releases.findLast(({ status }) => status === "published");
    const pack =
      current && document.type !== "themes"
        ? await readJson(join(catalogue.root, current.artifact))
        : null;
    const preset = document.type === "presets" ? (document.included?.pack ?? pack) : null;
    const profile =
      document.type === "loudness" ? (document.included?.item ?? pack?.items[0] ?? null) : null;
    const appRequirement = sharesetsAppRequirement(preset);
    if (!review && appRequirement === "Requires upcoming PLVS") {
      throw new Error("Unassigned PLVS compatibility for " + document.id);
    }
    for (const release of releases) files.add(release.artifact);
    for (const owner of [...releases, ...(document.included ? [document.included] : [])]) {
      for (const { path } of owner.previews) files.add(path);
      for (const revision of owner.previewRevisions ?? []) {
        for (const { path } of revision.previews) files.add(path);
      }
    }
    const included = document.included
      ? Object.fromEntries(
          Object.entries(document.included).filter(([key]) => !["pack", "item"].includes(key))
        )
      : document.included;
    listings.push({
      ...document,
      included,
      appRequirement,
      preset: presetView(preset),
      profile: profileView(profile),
    });
  }

  await mkdir(output);
  for (const file of files) {
    const target = join(output, "catalogue", file);
    await mkdir(dirname(target), { recursive: true });
    await cp(join(catalogue.root, file), target);
  }
  return {
    schemaVersion: 1,
    modules: Object.fromEntries(
      Object.entries(MODULE_CATALOG).map(([id, { title }]) => [id, title])
    ),
    stats: Object.fromEntries(
      Object.entries(STATS_META).map(([id, { label, unit }]) => [id, { label, unit }])
    ),
    listings,
    fileCount: files.size,
  };
}

export async function exportWebsiteInputs({
  productRoot,
  policyRoot,
  contentRoot,
  outputDirectory,
}) {
  const product = resolve(productRoot);
  const policy = resolve(policyRoot ?? product);
  const content = resolve(contentRoot ?? product);
  const output = resolve(outputDirectory);
  const productSha = sourceRevision(product);
  const policySha = policy === product ? productSha : sourceRevision(policy);
  const contentSha = content === product ? productSha : sourceRevision(content);
  const { version: productVersion } = await readJson(join(product, "package.json"));
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(productVersion)) {
    throw new Error("Website inputs require a stable product version");
  }

  const html = await readPrivacyPolicy(policy);
  const record = await readJson(join(policy, "docs/privacy-review.json"));
  const errors = validatePrivacyReview(html, record);
  if (errors.length) throw new Error(errors.join("\n"));
  const policyBody = /<main\b[^>]*>[\s\S]*?<\/main>/i.exec(html)?.[0];
  if (!policyBody) throw new Error("Expected a reviewed privacy policy main element");

  // Publish the manifest last so an interrupted export cannot be consumed.
  const catalogue = await writeCatalogueInputs({
    product,
    catalogueDirectory: join(content, "sharesets", "catalogue"),
    output,
  });
  await cp(join(product, "docs/user"), join(output, "guide"), { recursive: true });
  await writeFile(join(output, "policy.html"), policyBody, "utf8");
  const manifest = {
    ...catalogue,
    productSha,
    productVersion,
    releaseAssets: releaseAssetNames(productVersion),
    policySha,
    policyFingerprint: record.contentSha256,
    policyEffectiveDate: record.effectiveDate,
    contentSha,
  };
  await writeFile(join(output, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", {
    encoding: "utf8",
    flag: "wx",
  });
  return {
    productSha,
    policySha,
    contentSha,
    productVersion,
    listings: catalogue.listings.length,
    files: catalogue.fileCount,
  };
}

if (import.meta.main) {
  const [productRoot, outputDirectory, contentRoot, policyRoot] = process.argv.slice(2);
  try {
    if (!productRoot || !outputDirectory || process.argv.length > 6) {
      throw new Error(
        "Usage: node scripts/export-website-inputs.mjs <product checkout> <new output directory> [catalogue checkout] [privacy checkout]"
      );
    }
    console.log(
      JSON.stringify(
        await exportWebsiteInputs({ productRoot, outputDirectory, contentRoot, policyRoot }),
        null,
        2
      )
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
