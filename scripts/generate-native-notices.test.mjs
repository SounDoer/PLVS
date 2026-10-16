import { readFile } from "node:fs/promises";
import { describe, it, expect } from "vitest";
import { reviewedInputDigest } from "./generate-native-notices.mjs";

const path = "src-tauri/Cargo.toml";
const manifest = await readFile(new URL("../src-tauri/Cargo.toml", import.meta.url), "utf8");
const reviewed = reviewedInputDigest(path, Buffer.from(manifest));
const edit = (from, to) => {
  expect(manifest).toContain(from);
  return reviewedInputDigest(path, Buffer.from(manifest.replace(from, to)));
};

describe("native license review of the Cargo manifest", () => {
  it("keeps a release version bump out of the review", () => {
    const bumped = manifest.replace(/(\[workspace\.package\]\nversion = )"[^"]+"/, '$1"99.98.97"');
    expect(bumped).not.toBe(manifest);
    expect(reviewedInputDigest(path, Buffer.from(bumped))).toBe(reviewed);
  });

  it("still requires review for dependency and other manifest changes", () => {
    expect(edit("[dependencies]\n", '[dependencies]\nlibz-sys = "1"\n')).not.toBe(reviewed);
    expect(edit('rust-version = "1.95"', 'rust-version = "1.96"')).not.toBe(reviewed);
    expect(edit('name = "plvs"', 'name = "plvs"\nversion = "1.0.0"')).not.toBe(reviewed);
  });

  it("hashes every other reviewed input byte for byte", () => {
    const bytes = Buffer.from(manifest.replace(/version = "[^"]+"/, 'version = "99.98.97"'));
    expect(
      reviewedInputDigest("src-tauri/vendor/voice_activity_detector/Cargo.toml", bytes)
    ).not.toBe(
      reviewedInputDigest(
        "src-tauri/vendor/voice_activity_detector/Cargo.toml",
        Buffer.from(manifest)
      )
    );
  });
});
