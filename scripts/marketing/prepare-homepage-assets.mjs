import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";
import { readSharesetsSource } from "../sharesets-catalogue-source.mjs";
const output = resolve("website/assets/homepage");
// The feature originals live where publish-homepage-images.mjs writes them.
const raw = resolve(
  JSON.parse(await readFile(resolve("scripts/marketing/recipes/homepage-images.json"), "utf8"))
    .publication.rawDirectory
);
await mkdir(output, { recursive: true });
const responsive = resolve("website/assets/responsive");
await mkdir(responsive, { recursive: true });

// Resize from the original pipeline, never from a previously encoded WebP.
async function writeVariants(image, name, quality = 90) {
  // Materialize composites before resize: sharp otherwise resizes their canvas first.
  const original = sharp(await image.clone().png().toBuffer());
  const { width } = await original.metadata();
  for (const targetWidth of [480, 800, 1200].filter((value) => value < width)) {
    await original
      .clone()
      .resize({ width: targetWidth, withoutEnlargement: true })
      .webp({ quality, effort: 6 })
      .toFile(resolve(responsive, `${name}-${targetWidth}.webp`));
  }
}

async function writeHomepageImage(image, name, quality = 90) {
  await writeVariants(image, name, quality);
  await image.webp({ quality, effort: 6 }).toFile(resolve(output, `${name}.webp`));
}

await writeVariants(sharp(resolve("website/assets/raw/landing-hero.png")), "landing-hero");
const previews = {
  spectral: ["spectral-inspection", "preset-workspace"],
  stereo: ["stereo-field-check", "preset-workspace"],
  "meter-bridge": ["meter-bridge", "preset-workspace-5-1"],
  amber: ["control-room-amber", "product-workspace-file"],
  night: ["night-circuit", "product-workspace-file"],
  graphite: ["graphite-monitor", "product-workspace-file"],
  paper: ["paper-console", "product-workspace-file"],
};
const catalogue = await readSharesetsSource(resolve("sharesets/catalogue"));
// Preserve the real preview pixels and proportions; only change delivery encoding.
for (const [name, [listingId, previewId]] of Object.entries(previews)) {
  const listing = catalogue.listings.find(({ document }) => document.id === listingId)?.document;
  const content =
    listing?.included ?? listing?.releases.filter((r) => r.status === "published").at(-1);
  const current = content?.previewRevisions?.at(-1) ?? content;
  const preview = current?.previews.find(({ id }) => id === previewId);
  if (!preview) throw new Error(`Missing current homepage preview: ${listingId}/${previewId}`);
  await writeHomepageImage(sharp(resolve(catalogue.root, preview.path)), name);
}
await writeHomepageImage(sharp(resolve(raw, "history.png")), "history");
const full = await sharp(resolve(raw, "frequency-full.png")).metadata();
const detail = await sharp(resolve(raw, "frequency-detail.png")).metadata();
await writeHomepageImage(
  sharp({
    create: {
      width: full.width,
      height: full.height + detail.height + 16,
      channels: 3,
      background: "#070707",
    },
  }).composite([
    { input: resolve(raw, "frequency-full.png"), left: 0, top: 0 },
    { input: resolve(raw, "frequency-detail.png"), left: 0, top: full.height + 16 },
  ]),
  "frequency"
);
// The Profile editor original is rendered at its published crop. UI and data are unretouched.
await writeHomepageImage(sharp(resolve(raw, "rules-editor.png")), "rules", 95);
await writeHomepageImage(sharp(resolve(raw, "multichannel.png")), "multichannel");
console.log("Homepage previews and responsive variants prepared.");
