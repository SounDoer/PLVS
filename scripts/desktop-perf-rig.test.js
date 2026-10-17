import { describe, expect, it } from "vitest";

import {
  MACOS_DEFAULT_EXE,
  conflictingMacDevPids,
  defaultDesktopExecutable,
  parseRigArgs,
} from "./desktop-perf-rig.mjs";

describe("parseRigArgs", () => {
  it("selects the native optimized executable", () => {
    expect(defaultDesktopExecutable("darwin")).toBe(MACOS_DEFAULT_EXE);
    expect(defaultDesktopExecutable("win32")).toMatch(/plvs\.exe$/);
  });

  it("finds conflicting dev applications without matching unrelated PLVS identities", () => {
    expect(
      conflictingMacDevPids(
        `
          10 /repo/src-tauri/target/release/bundle/macos/PLVS Dev.app/Contents/MacOS/plvs
          11 /Applications/PLVS.app/Contents/MacOS/plvs
          12 /repo/src-tauri/target/release/bundle/macos/PLVS Dev.app/Contents/MacOS/plvs --flag
        `,
        "/repo/src-tauri/target/release/bundle/macos/PLVS Dev.app/Contents/MacOS/plvs"
      )
    ).toEqual([10, 12]);
  });

  it("parses the shared desktop performance options", () => {
    const options = parseRigArgs([
      "--port=9333",
      "--scenario",
      "heavy",
      "--seconds",
      "60",
      "--every=5",
      "--browser-args=--disable-gpu",
    ]);
    expect(options).toMatchObject({
      port: 9333,
      scenario: "heavy",
      seconds: 60,
      every: 5,
      browserArgs: "--disable-gpu",
    });
  });

  it("rejects an unknown scenario and non-positive timing", () => {
    expect(() => parseRigArgs(["--scenario", "unknown"])).toThrow(/scenario/);
    expect(() => parseRigArgs(["--seconds", "0"])).toThrow(/positive/);
  });
});
