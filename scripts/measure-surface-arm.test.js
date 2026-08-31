import { describe, expect, it } from "vitest";

import { assertCaptureDevice, assertSingleApp, parseArgs } from "./measure-surface-arm.mjs";

describe("assertSingleApp", () => {
  it("accepts one app", () => {
    expect(assertSingleApp("plvs")).toBe("plvs");
  });

  it("rejects a second app left over from the previous arm", () => {
    // The failure this guards: `Get-Process plvs` does not match a renamed build, so the previous
    // arm survives the kill and the two race for one debugging port.
    expect(() => assertSingleApp("plvs\nplvs-armB-measure")).toThrow(/racing for the debugging port/);
  });

  it("rejects nothing having started", () => {
    expect(() => assertSingleApp("")).toThrow(/did not start/);
  });
});

describe("assertCaptureDevice", () => {
  it("accepts the label the status bar actually shows for the requested device", () => {
    // Asking for "CABLE Output" gets a status bar reading "VB-Audio Virtual Cable"; matching on the
    // first token is what bridges the two.
    expect(assertCaptureDevice("CABLE Output", "CABLE Output")).toBe("CABLE Output");
  });

  it("rejects the device the app falls back to, which records silence", () => {
    // The capture device does not persist across launches, so an arm comes up on whatever the
    // profile names -- with an empty panel and no error anywhere.
    expect(() => assertCaptureDevice("4- Apogee Symphony Desktop", "CABLE Output")).toThrow(
      /would record silence/
    );
  });

  it("rejects an empty status bar rather than passing it", () => {
    expect(() => assertCaptureDevice("", "CABLE Output")).toThrow(/would record silence/);
  });
});

describe("parseArgs", () => {
  it("requires the arm to say which renderer it expects", () => {
    expect(() => parseArgs(["--exe", "x.exe"])).toThrow(/--expect/);
    expect(parseArgs(["--exe", "x.exe", "--expect", "gl"]).expect).toBe("gl");
  });

  it("requires an executable", () => {
    expect(() => parseArgs(["--expect", "cpu"])).toThrow(/--exe/);
  });

  it("passes extra browser arguments through for the no-GPU arm", () => {
    const options = parseArgs([
      "--exe",
      "x.exe",
      "--expect",
      "gl",
      "--browser-args",
      "--disable-gpu",
    ]);
    expect(options.extraBrowserArgs).toBe("--disable-gpu");
  });
});
