import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (name) => readFileSync(`.github/workflows/${name}.yml`, "utf8");
const workflow = read("publish-site");

describe("Sharesets content deployment", () => {
  it("routes both entry points through the same publication gate", () => {
    for (const name of ["deploy-website", "deploy-sharesets"]) {
      expect(read(name)).toContain("uses: ./.github/workflows/publish-site.yml");
      expect(read(name)).not.toContain("actions/deploy-pages");
    }
    expect(read("deploy-website")).toContain("product_ref: ${{ inputs.ref }}");
    expect(read("deploy-website")).toContain("website_ref: ${{ inputs.website_ref }}");
    expect(read("deploy-website")).toContain("policy_ref: ${{ inputs.policy_ref }}");
    expect(read("deploy-sharesets")).toContain("content_ref: ${{ inputs.content_ref }}");
    expect(read("deploy-sharesets")).not.toContain("website_ref:");
  });

  it("resolves exact product, site, privacy and content revisions before the build", () => {
    expect(workflow).toContain("node scripts/resolve-website-deployment.mjs");
    for (const sha of ["productSha", "siteSha", "policySha", "contentSha"]) {
      expect(workflow).toContain("ref: ${{ steps.plan.outputs." + sha + " }}");
    }
    expect(workflow).toContain("repository: SounDoer/PLVS-Website");
  });

  it("resolves live history and validates it before uploading anything", () => {
    const resolve = workflow.indexOf("resolve-website-deployment.mjs");
    const validate = workflow.indexOf(
      "sharesets-catalogue-update.mjs ../published-content-source/sharesets/catalogue ../content-source/sharesets/catalogue"
    );
    const marker = workflow.indexOf(
      "sharesets-publication.mjs write _site/sharesets/publication.json"
    );
    const upload = workflow.indexOf("actions/upload-pages-artifact");
    expect(resolve).toBeGreaterThan(0);
    expect(validate).toBeGreaterThan(resolve);
    expect(marker).toBeGreaterThan(validate);
    expect(upload).toBeGreaterThan(marker);
    expect(workflow).toContain("ref: ${{ steps.plan.outputs.baselineSha }}");
    expect(workflow).toContain("steps.plan.outputs.contentSha");
  });

  it("serializes complete publications without cancelling an in-flight replacement", () => {
    expect(workflow).toContain("group: pages");
    expect(workflow).toContain("cancel-in-progress: false");
    expect(workflow).toContain("path: _site/");
    expect(workflow).toContain("actions/deploy-pages@v5");
  });

  it("uses the same complete-site builder as local development", () => {
    expect(workflow).toContain("npm run build -- ../site-inputs ../../_site");
    expect(workflow).not.toContain("cp -r site-source/website _site");
  });

  it("records publication identities before upload and checks both live markers after deployment", () => {
    expect(workflow.indexOf("website-deployment-marker.mjs write")).toBeLessThan(
      workflow.indexOf("actions/upload-pages-artifact")
    );
    expect(workflow.indexOf("website-deployment-marker.mjs verify")).toBeGreaterThan(
      workflow.indexOf("actions/deploy-pages@v5")
    );
  });
});
