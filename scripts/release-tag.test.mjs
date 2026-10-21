import { describe, expect, it } from "vitest";
import { STABLE_RELEASE_TAG_GLOB } from "./release-tag.mjs";

describe("STABLE_RELEASE_TAG_GLOB", () => {
  it("keeps Preview tags out of the stable release baseline", () => {
    expect(STABLE_RELEASE_TAG_GLOB).toBe("v[0-9]*.[0-9]*.[0-9]*");
  });
});
