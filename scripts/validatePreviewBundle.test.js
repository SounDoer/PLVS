import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { previewAssetNames, validatePreviewBundle } from "./validate-preview-bundle.mjs";

const temporaryDirectories = [];
const sha = "0123456789abcdef0123456789abcdef01234567";

function temporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), "plvs-preview-bundle-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("Preview bundle validation", () => {
  it("accepts exactly the non-empty installer and Portable ZIP for the commit", () => {
    const directory = temporaryDirectory();
    for (const name of Object.values(previewAssetNames("0.16.0", sha))) {
      writeFileSync(join(directory, name), "package");
    }
    expect(validatePreviewBundle("0.16.0", sha, directory)).toEqual({
      installer: "PLVS-Preview_0.16.0-preview.0123456_x64-setup.exe",
      portable: "PLVS-Preview-v0.16.0-preview.0123456-x64-portable.zip",
    });
  });

  it("rejects missing, extra, empty, directory, version, and SHA inputs", () => {
    const directory = temporaryDirectory();
    const names = previewAssetNames("0.16.0", sha);
    writeFileSync(join(directory, names.installer), "package");
    expect(() => validatePreviewBundle("0.16.0", sha, directory)).toThrow("asset set mismatch");
    writeFileSync(join(directory, names.portable), "");
    expect(() => validatePreviewBundle("0.16.0", sha, directory)).toThrow("is empty");
    writeFileSync(join(directory, names.portable), "package");
    writeFileSync(join(directory, "unexpected.txt"), "extra");
    expect(() => validatePreviewBundle("0.16.0", sha, directory)).toThrow("asset set mismatch");
    rmSync(join(directory, "unexpected.txt"));
    rmSync(join(directory, names.portable));
    mkdirSync(join(directory, names.portable));
    expect(() => validatePreviewBundle("0.16.0", sha, directory)).toThrow("is not a file");
    expect(() => previewAssetNames("v0.16.0", sha)).toThrow("base version");
    expect(() => previewAssetNames("0.16.0", "0123456")).toThrow("commit SHA");
  });
});
