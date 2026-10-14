import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect } from "vitest";
import {
  assertReviewed,
  assertNoRestrictedComponent,
  collectNoticeFiles,
  assertInstalledPackageVersion,
} from "./generate-component-notices.mjs";

describe("component notice review gate", () => {
  it("rejects stale installed packages before their notices can be approved for a locked version", () => {
    const expected = { name: "@tauri-apps/api", version: "2.12.1" };
    expect(() =>
      assertInstalledPackageVersion(expected, { ...expected, version: "2.11.0" })
    ).toThrow("Run npm ci");
    expect(() =>
      assertInstalledPackageVersion(expected, { ...expected, name: "another-package" })
    ).toThrow("does not match lockfile");
    expect(() => assertInstalledPackageVersion(expected, expected)).not.toThrow();
  });
  it("does not let wrapper metadata approve a separately restricted embedded model", () => {
    expect(() =>
      assertNoRestrictedComponent("rust:ten-vad-rs@0.1.7", {
        "rust:ten-vad-rs": "The upstream model has additional usage restrictions",
      })
    ).toThrow("additional usage restrictions");
    expect(() =>
      assertNoRestrictedComponent("rust:unrelated@1.0", {
        "rust:ten-vad-rs": "Additional model restrictions",
      })
    ).not.toThrow();
  });
  it("rejects a new version, changed license, and unknown license even if explicitly listed", () => {
    expect(() => assertReviewed({ id: "npm:example@2", license: "MIT" }, undefined)).toThrow(
      "Unreviewed"
    );
    expect(() =>
      assertReviewed({ id: "npm:example@1", license: "GPL-3.0-only" }, { license: "MIT" })
    ).toThrow("changed license");
    expect(() =>
      assertReviewed({ id: "npm:example@1", license: "UNKNOWN" }, { license: "UNKNOWN" })
    ).toThrow("Unreviewed");
    expect(() =>
      assertReviewed({ id: "npm:example@1", license: "MIT" }, { license: "MIT" })
    ).not.toThrow();
  });

  it("retains embedded third-party notices without attributing a nested npm package to its parent", async () => {
    const directory = await mkdtemp(join(tmpdir(), "plvs-notice-discovery-"));
    try {
      await mkdir(join(directory, "third_party", "fiat"), { recursive: true });
      await mkdir(join(directory, "node_modules", "other"), { recursive: true });
      for (const file of [
        "LICENSE",
        "THIRD_PARTY_NOTICES.md",
        "third_party/fiat/LICENSE",
        "node_modules/other/LICENSE",
        "README.md",
      ]) {
        await writeFile(join(directory, file), "fixture");
      }
      expect(await collectNoticeFiles(directory)).toEqual([
        "LICENSE",
        "THIRD_PARTY_NOTICES.md",
        "third_party/fiat/LICENSE",
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
