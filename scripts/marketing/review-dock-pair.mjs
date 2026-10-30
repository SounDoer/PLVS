// Responsive check of the homepage Dock pair against a running `npm run website:dev`.
import process from "node:process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { homepageRecipeProblems, publicationTarget } from "./homepage-render-lib.mjs";

if (process.argv.length > 2) throw new Error("Usage: node scripts/marketing/review-dock-pair.mjs");
const ROOT = resolve(import.meta.dirname, "../..");
const recipe = JSON.parse(
  await readFile(join(ROOT, "scripts/marketing/recipes/homepage-images.json"), "utf8")
);
const problems = homepageRecipeProblems(recipe);
if (problems.length) throw new Error(problems.join("\n"));
const strips = recipe.images.filter(({ scene }) => scene === "dock");
const url = "http://127.0.0.1:4173/";
const viewports = [1440, 820, 390];
const scrollViewport = 390;
try {
  await fetch(url, { signal: AbortSignal.timeout(3000) });
} catch {
  throw new Error(`${url} is not reachable. Start npm run website:dev in another terminal first.`);
}
const output = join(ROOT, "artifacts/marketing", `homepage-dock-review-${Date.now()}`);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const width of viewports) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(url, { waitUntil: "networkidle" });
    const docks = page.locator(".workspace-dock");
    if ((await docks.count()) !== strips.length)
      throw new Error(`Expected ${strips.length} Dock images at ${width}px.`);
    for (const img of await docks.locator("img").all()) {
      await img.scrollIntoViewIfNeeded();
      await img.evaluate((i) => i.decode());
    }
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth))
      throw new Error(`Page overflows horizontally at ${width}px.`);
    const geometry = await docks.locator("img").evaluateAll((nodes) =>
      nodes.map((i) => ({
        src: i.getAttribute("src"),
        width: i.naturalWidth,
        height: i.naturalHeight,
        rendered: i.clientWidth,
        container: i.parentElement.clientWidth,
      }))
    );
    if (
      geometry.some((image, index) => {
        const strip = strips[index];
        const target = publicationTarget(recipe, strip.name);
        return (
          image.src !== target.webp.replace(/^website\//, "") ||
          image.width !== strip.output.width ||
          image.height !== strip.output.height
        );
      })
    )
      throw new Error(`Wrong Dock image dimensions at ${width}px: ${JSON.stringify(geometry)}`);
    await page
      .locator(".feature-workspace")
      .screenshot({ path: join(output, `workspace-${width}.png`) });
    if (width === scrollViewport) {
      for (const visual of await docks.locator(".workspace-dock-visual").all()) {
        await visual.evaluate((e) => {
          e.scrollLeft = e.scrollWidth;
        });
        if (!(await visual.evaluate((e) => e.scrollLeft > 0)))
          throw new Error(`Dock is not horizontally scrollable at ${width}px.`);
      }
    }
    if (errors.length) throw new Error(errors.join("\n"));
    results.push({ width, geometry, passed: true });
    await page.close();
  }
} finally {
  await browser.close();
}
await writeFile(join(output, "review.json"), JSON.stringify(results, null, 2) + "\n");
console.log(`${results.length} responsive viewport checks passed. Screenshots: ${output}`);
