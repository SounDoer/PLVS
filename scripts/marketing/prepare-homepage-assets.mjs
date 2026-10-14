import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";
const output = resolve("website/assets/homepage");
const raw = resolve("website/assets/raw/homepage-20261014");
await mkdir(output, { recursive: true });
const previews = {
  essential: "essential-monitoring/v1/preset-workspace.png",
  spectral: "spectral-inspection/v1/preset-workspace.png",
  stereo: "stereo-field-check/v1/preset-workspace.png",
  amber: "control-room-amber/v1/product-workspace-file.png",
  daylight: "studio-daylight/v1/product-workspace-file.png",
  night: "night-circuit/v1/product-workspace-file.png",
};
// Preserve the real preview pixels and proportions; only change delivery encoding.
for (const [name, source] of Object.entries(previews))
  await sharp(resolve("sharesets/catalogue/previews", source))
    .webp({ quality: 90, effort: 6 })
    .toFile(resolve(output, name + ".webp"));
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
// Crop the complete Profile editor from the same workbench as the multichannel result.
// The saved seven-rule Profile is active in both captures; UI and data are unretouched.
await sharp(resolve(raw, "rules-editor.png"))
  .extract({ left: 150, top: 150, width: 560, height: 500 })
  .webp({ quality: 95, effort: 6 })
  .toFile(resolve(output, "rules.webp"));
console.log("Homepage previews prepared.");

await sharp(resolve(raw, "multichannel.png"))
  .webp({ quality: 90, effort: 6 })
  .toFile(resolve(output, "multichannel.webp"));
