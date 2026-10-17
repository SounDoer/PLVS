import { describe, expect, it } from "vitest";

import {
  acceptanceBuildLayout,
  assertCommittedSource,
  macUpdaterArchiveCommand,
  platformTargetTriple,
  replaceCargoWorkspaceVersion,
} from "./build-update-acceptance.mjs";

const sha = "0123456789abcdef0123456789abcdef01234567";

describe("update acceptance builder", () => {
  it("uses a source- and platform-scoped artifact layout", () => {
    const mac = acceptanceBuildLayout({
      repository: "/repo",
      sourceSha: sha,
      platform: "darwin",
      arch: "arm64",
    });
    expect(mac.root).toBe("/repo/artifacts/update-acceptance/01234567");
    expect(mac.snapshot).toBe("/repo/artifacts/update-acceptance/01234567/source");
    expect(mac.descriptor.key).toBe("darwin-aarch64");
    expect(mac.names.identity).toBe("com.soundoer.plvs.updatetest.h01234567");
  });

  it("refuses to build a receipt from a dirty source tree", () => {
    const calls = [];
    const invoke = (command, args) => {
      calls.push([command, args]);
      return args[0] === "status" ? " M src/main.js" : sha;
    };
    expect(() => assertCommittedSource("/repo", invoke)).toThrow(/clean worktree/);
    expect(calls).toHaveLength(1);
  });

  it("records the exact committed SHA only after the clean check", () => {
    const invoke = (_command, args) => (args[0] === "status" ? "" : sha);
    expect(assertCommittedSource("/repo", invoke)).toBe(sha);
  });

  it.each([
    [{ os: "windows", arch: "x86_64" }, "x86_64-pc-windows-msvc"],
    [{ os: "macos", arch: "aarch64" }, "aarch64-apple-darwin"],
    [{ os: "macos", arch: "x86_64" }, "x86_64-apple-darwin"],
  ])("derives the native target triple from %o", (descriptor, expected) => {
    expect(platformTargetTriple(descriptor)).toBe(expected);
  });

  it("accepts the repository version when the first package needs no textual version change", () => {
    const cargo = '[workspace.package]\nversion = "0.21.0"\nedition = "2021"\n';
    expect(replaceCargoWorkspaceVersion(cargo, "0.21.0")).toBe(cargo);
    expect(replaceCargoWorkspaceVersion(cargo, "0.21.1")).toContain('version = "0.21.1"');
    expect(() => replaceCargoWorkspaceVersion('[package]\nname = "plvs"', "0.21.0")).toThrow(
      /seam changed/
    );
  });

  it("disables AppleDouble metadata in macOS updater archives", () => {
    expect(macUpdaterArchiveCommand("/out/Test App.app", "/out/update.tar.gz", "/out")).toEqual({
      args: ["-czf", "/out/update.tar.gz", "-C", "/out", "Test App.app"],
      env: { COPYFILE_DISABLE: "1" },
    });
  });
});
