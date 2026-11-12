import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export async function websiteCheckout(productRoot) {
  const root = resolve(
    process.env.PLVS_WEBSITE_CHECKOUT ?? join(productRoot, "..", "PLVS-Website")
  );
  const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  if (manifest.name !== "plvs-website")
    throw new Error("Expected a PLVS-Website checkout: " + root);
  return root;
}
