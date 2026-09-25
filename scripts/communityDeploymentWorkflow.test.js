import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(".github/workflows/deploy-community.yml", "utf8");

describe("Community content deployment", () => {
  it("takes site code only from the latest stable Release", () => {
    expect(workflow).toContain("releases/latest --jq .tag_name");
    expect(workflow).toContain("ref: ${{ steps.release.outputs.tag }}");
    expect(workflow).toContain("path: site-source");
  });

  it("keeps the replaceable content checkout separate and validates it", () => {
    expect(workflow).toContain("ref: ${{ inputs.content_ref }}");
    expect(workflow).toContain("path: content-source");
    expect(workflow).toContain("sparse-checkout: community/catalogue");
    expect(workflow).toContain(
      "node site-source/scripts/validate-community-source.mjs content-source/community/catalogue"
    );
    expect(workflow).toContain(
      "node site-source/scripts/build-community-site.mjs content-source/community/catalogue _site/community"
    );
  });

  it("deploys one complete Pages artifact under the shared pages lock", () => {
    expect(workflow).toContain("group: pages");
    expect(workflow).toContain("path: _site/");
    expect(workflow).toContain("actions/deploy-pages@v5");
  });
});
