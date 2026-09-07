import { describe, expect, it } from "vitest";
import { cliArtifactPaths, parseRustHostTriple } from "./build-plvs-cli.mjs";

describe("PLVS CLI build staging", () => {
  it("parses the host triple reported by rustc", () => {
    expect(parseRustHostTriple("rustc 1.95.0\nhost: x86_64-pc-windows-msvc\n")).toBe(
      "x86_64-pc-windows-msvc"
    );
  });

  it("uses Cargo's shared host target directory and Tauri's Windows input name", () => {
    const paths = cliArtifactPaths({
      targetDirectory: "C:\\repo\\src-tauri\\target",
      profile: "release",
      targetTriple: "x86_64-pc-windows-msvc",
    });

    expect(paths.executable).toMatch(/target[\\/]release[\\/]plvs-cli\.exe$/);
    expect(paths.staged).toMatch(
      /src-tauri[\\/]binaries[\\/]plvs-cli-x86_64-pc-windows-msvc\.exe$/
    );
  });

  it("uses the target-specific directory for a cross-compiled macOS artifact", () => {
    const paths = cliArtifactPaths({
      targetDirectory: "/repo/src-tauri/target",
      profile: "release",
      targetTriple: "aarch64-apple-darwin",
      crossTarget: true,
    });

    expect(paths.executable).toMatch(/target[\\/]aarch64-apple-darwin[\\/]release[\\/]plvs-cli$/);
    expect(paths.staged).toMatch(/src-tauri[\\/]binaries[\\/]plvs-cli-aarch64-apple-darwin$/);
  });
});
