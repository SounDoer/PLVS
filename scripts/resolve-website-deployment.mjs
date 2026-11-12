import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { releaseAssetNames } from "./release-assets.mjs";
import { resolvePublishedSharesets } from "./sharesets-publication.mjs";
import { requireSuccessfulCI, validateWebsiteMarker } from "./website-publication.mjs";

export const SITE_REPOSITORY = "SounDoer/PLVS-Website";
const sha = /^[a-f0-9]{40}$/;
const stableTag = /^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;
const bootstrapSiteSha = "8ff6d4c5cedc193a3ad7fadf5169ff3f6649a87f";

function exact(value, label) {
  if (!sha.test(value ?? "")) throw new Error(label + " requires a full commit SHA");
  return value;
}

export function verifyProductRelease(release, tag, productSha, tagSha) {
  if (
    !stableTag.test(tag) ||
    release.tag_name !== tag ||
    release.draft ||
    release.prerelease ||
    productSha !== tagSha
  ) {
    throw new Error("Website product must be a published stable release at the selected commit");
  }
  const { windowsInstaller, windowsPortable, macosDmg, linuxDeb } = releaseAssetNames(tag.slice(1));
  const names = new Set(release.assets.map(({ name }) => name));
  for (const asset of [windowsInstaller, windowsPortable, macosDmg, linuxDeb]) {
    if (!names.has(asset)) throw new Error("Published release is missing " + asset);
  }
}

export async function selectPolicyRef({
  productSha,
  previousProduct,
  livePolicy,
  forward,
  explicit,
  digest,
}) {
  if (explicit) return exact(explicit, "Privacy policy");
  if (!forward || productSha === previousProduct) return livePolicy;
  const [oldDigest, newDigest] = await Promise.all([digest(previousProduct), digest(productSha)]);
  if (oldDigest === newDigest) return livePolicy;
  if (livePolicy !== previousProduct) {
    const liveDigest = await digest(livePolicy);
    if (liveDigest !== oldDigest && liveDigest !== newDigest) {
      throw new Error(
        "Product and independently published privacy policies changed. Review and select an exact policy commit."
      );
    }
  }
  return productSha;
}

const api = (path) => JSON.parse(execFileSync("gh", ["api", path], { encoding: "utf8" }));

async function verifySiteCI(siteSha) {
  const path = `repos/${SITE_REPOSITORY}/actions/workflows/ci.yml/runs?head_sha=${siteSha}&event=push&status=success`;
  let runs;
  try {
    runs = JSON.parse(
      execFileSync("gh", ["api", path], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
    ).workflow_runs;
  } catch {
    // A repository-scoped Actions token may be unable to read another public repo's runs.
    const response = await fetch(`https://api.github.com/${path}`, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Cannot verify website source CI (HTTP ${response.status})`);
    runs = (await response.json()).workflow_runs;
  }
  requireSuccessfulCI(runs, siteSha);
}

async function main() {
  const {
    GITHUB_REPOSITORY: repository,
    GITHUB_OUTPUT: output,
    PRODUCT_REF: productRef,
    WEBSITE_SOURCE_REF: websiteRef,
    CONTENT_REF: contentRef,
    POLICY_REF: policyRef,
  } = process.env;
  const host = readFileSync("website/CNAME", "utf8").trim();
  const [response, history] = await Promise.all([
    fetch("https://" + host + "/publication.json?review=" + Date.now(), {
      signal: AbortSignal.timeout(30_000),
      redirect: "error",
      headers: { "Cache-Control": "no-cache" },
    }),
    resolvePublishedSharesets({ host, repository }),
  ]);
  if (!response.ok) throw new Error("Cannot read the live website publication marker");
  const live = validateWebsiteMarker(await response.json(), repository);
  if (live.contentSha !== history.commitSha) throw new Error("Live publication markers disagree");

  const ref =
    !productRef || productRef === "main"
      ? api("repos/" + repository + "/releases/latest").tag_name
      : productRef;
  if (!stableTag.test(ref) && !sha.test(ref))
    throw new Error("Use a stable release tag or its exact commit");
  const productSha = exact(api("repos/" + repository + "/commits/" + ref).sha, "PLVS product");
  const contents = (path, revision) =>
    JSON.parse(
      Buffer.from(
        api("repos/" + repository + "/contents/" + path + "?ref=" + revision).content,
        "base64"
      ).toString("utf8")
    );
  const tag = "v" + contents("package.json", productSha).version;
  if (!stableTag.test(tag)) throw new Error("Invalid product release tag");
  verifyProductRelease(
    api("repos/" + repository + "/releases/tags/" + tag),
    tag,
    productSha,
    api("repos/" + repository + "/commits/" + tag).sha
  );
  const productRuns = api(
    "repos/" +
      repository +
      "/actions/workflows/ci.yml/runs?head_sha=" +
      productSha +
      "&event=push&status=success"
  ).workflow_runs;
  requireSuccessfulCI(productRuns, productSha);

  const siteSha = exact(websiteRef || live.siteSourceSha || bootstrapSiteSha, "Website source");
  await verifySiteCI(siteSha);

  const previousProduct = exact(live.productSha ?? live.websiteSha, "Live product");
  const livePolicy = exact(live.policySha ?? live.websiteSha, "Live privacy policy");
  const forward =
    productSha !== previousProduct &&
    api("repos/" + repository + "/compare/" + previousProduct + "..." + productSha).status ===
      "ahead";
  if (contentRef && contentRef !== "main") exact(contentRef, "Catalogue");
  const contentSha = contentRef
    ? exact(api("repos/" + repository + "/commits/" + contentRef).sha, "Catalogue")
    : forward
      ? productSha
      : history.commitSha;
  const digest = (revision) => {
    const { contentSha256, effectiveDate } = contents("docs/privacy-review.json", revision);
    return `${contentSha256}/${effectiveDate}`;
  };
  const policySha = await selectPolicyRef({
    productSha,
    previousProduct,
    livePolicy,
    forward,
    explicit: policyRef,
    digest,
  });

  const plan = { productSha, siteSha, contentSha, policySha, baselineSha: history.commitSha };
  console.log(JSON.stringify(plan, null, 2));
  if (output) {
    appendFileSync(
      output,
      Object.entries(plan)
        .map(([key, value]) => key + "=" + value + "\n")
        .join("")
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
