import { describe, expect, it } from "vitest";
import { newRequestId, parsePreviewPlatform, remoteBranchSha } from "./preview-dispatch.mjs";

describe("preview dispatch", () => {
  it("defaults to every platform and accepts each single platform", () => {
    expect(parsePreviewPlatform([])).toBe("all");
    for (const platform of ["all", "windows", "macos", "linux"]) {
      expect(parsePreviewPlatform([platform])).toBe(platform);
    }
  });

  it("rejects unknown or extra platform arguments", () => {
    expect(() => parsePreviewPlatform(["mac"])).toThrow('Unknown platform "mac"');
    expect(() => parsePreviewPlatform(["windows", "linux"])).toThrow("at most one platform");
  });

  it("generates request ids the workflow accepts", () => {
    const ids = new Set(Array.from({ length: 20 }, newRequestId));
    expect(ids.size).toBe(20);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]{6,32}$/);
  });

  it("reads the remote branch SHA, or null when the branch is not pushed", () => {
    const sha = "0123456789abcdef0123456789abcdef01234567";
    expect(remoteBranchSha(`${sha}\trefs/heads/feature\n`)).toBe(sha);
    expect(remoteBranchSha("")).toBeNull();
  });
});
