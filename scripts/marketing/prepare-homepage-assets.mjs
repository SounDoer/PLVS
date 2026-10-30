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
  await sharp(resolve(catalogue.root, preview.path))
    .webp({ quality: 90, effort: 6 })
    .toFile(resolve(output, name + ".webp"));
}
await sharp(resolve(raw, "history.png"))
  .webp({ quality: 90, effort: 6 })
  .toFile(resolve(output, "history.webp"));
const full = await sharp(resolve(raw, "frequency-full.png")).metadata();
const detail = await sharp(resolve(raw, "frequency-detail.png")).metadata();
await sharp({
  create: {
    width: full.width,
    height: full.height + detail.height + 16,
    channels: 3,
    background: "#070707",
  },
})
  .composite([
    { input: resolve(raw, "frequency-full.png"), left: 0, top: 0 },
    { input: resolve(raw, "frequency-detail.png"), left: 0, top: full.height + 16 },
  ])
  .webp({ quality: 90, effort: 6 })
  .toFile(resolve(output, "frequency.webp"));
// The Profile editor original is rendered at its published crop. UI and data are unretouched.
await sharp(resolve(raw, "rules-editor.png"))
  .webp({ quality: 95, effort: 6 })
  .toFile(resolve(output, "rules.webp"));
console.log("Homepage previews prepared.");

await sharp(resolve(raw, "multichannel.png"))
  .webp({ quality: 90, effort: 6 })
  .toFile(resolve(output, "multichannel.webp"));
