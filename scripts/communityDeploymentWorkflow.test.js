import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (name) => readFileSync(`.github/workflows/${name}.yml`, "utf8");
const workflow = read("publish-site");

describe("Community content deployment", () => {
  it("routes both entry points through the same publication gate", () => {
    for (const name of ["deploy-landing", "deploy-community"]) {
      expect(read(name)).toContain("uses: ./.github/workflows/publish-site.yml");
      expect(read(name)).not.toContain("actions/deploy-pages");
    }
    expect(read("deploy-landing")).toContain("site_ref: ${{ inputs.ref }}");
    expect(read("deploy-community")).toContain("content_ref: ${{ inputs.content_ref }}");
    expect(read("deploy-community")).not.toContain("site_ref:");
    expect(read("deploy-community")).not.toContain("bootstrap_community:");
  });

  it("uses the latest stable website for content-only updates and pins default content to the website commit", () => {
    expect(workflow).toContain('releases/latest" --jq .tag_name');
    expect(workflow).toContain("path: site-source");
    expect(workflow).toContain("CONTENT_REF=$(git -C site-source rev-parse HEAD)");
    expect(workflow).toContain("path: content-source");
  });

  it("resolves live history and validates it before uploading anything", () => {
    const resolve = workflow.indexOf("community-publication.mjs resolve");
    const validate = workflow.indexOf(
      "community-catalogue-update.mjs published-content-source/community/catalogue content-source/community/catalogue"
    );
    const marker = workflow.indexOf(
      "community-publication.mjs write _site/community/publication.json"
    );
    const upload = workflow.indexOf("actions/upload-pages-artifact");
    expect(resolve).toBeGreaterThan(0);
    expect(validate).toBeGreaterThan(resolve);
    expect(marker).toBeGreaterThan(validate);
    expect(upload).toBeGreaterThan(marker);
    expect(workflow).toContain("ref: ${{ steps.baseline.outputs.ref }}");
    expect(workflow).toContain("candidate_sha=$(git -C content-source rev-parse HEAD)");
  });

  it("serializes complete publications without cancelling an in-flight replacement", () => {
    expect(workflow).toContain("group: pages");
    expect(workflow).toContain("cancel-in-progress: false");
    expect(workflow).toContain("path: _site/");
    expect(workflow).toContain("actions/deploy-pages@v5");
  });
});
