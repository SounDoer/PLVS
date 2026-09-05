import { describe, it, expect } from "vitest";
import * as captureChanges from "./audio-code-changed.mjs";

describe("filterCaptureSmokePaths", () => {
  it("selects capture sources and the smoke harness path", () => {
    expect(captureChanges.filterCaptureSmokePaths).toBeTypeOf("function");
    expect(
      captureChanges.filterCaptureSmokePaths([
        "src-tauri/src/audio/cpal_backend.rs",
        "src-tauri/src/dsp/loudness.rs",
        "src-tauri/src/engine/meter_pipeline.rs",
        "src-tauri/src/harness_main.rs",
        "src-tauri/src/cli_main.rs",
        "src-tauri/src/cli_capture.rs",
        "src-tauri/src/cli_analyze.rs",
        "src-tauri/src/cli_report.rs",
        "scripts/capture-rig.mjs",
        "scripts/smoke-capture.mjs",
      ]),
    ).toHaveLength(10);
  });

  it("ignores files that cannot affect capture smoke", () => {
    // The overwhelming majority of this project's commits are dock/UI work.
    // Soaking or smoking those would be pure waste.
    expect(
      captureChanges.filterCaptureSmokePaths([
        "src/dock/DockStrip.jsx",
        "docs/cli.md",
        "README.md",
        "src-tauri/src/lib.rs",
        "scripts/soak-capture.mjs",
      ]),
    ).toEqual([]);
  });

  it("selects a mixed changeset down to only capture-smoke dependencies", () => {
    expect(
      captureChanges.filterCaptureSmokePaths([
        "src/App.jsx",
        "src-tauri/src/audio/device_enum.rs",
        "scripts/capture-rig.mjs",
        "package.json",
      ]),
    ).toEqual(["src-tauri/src/audio/device_enum.rs", "scripts/capture-rig.mjs"]);
  });

  it("declares the paths it guards", () => {
    expect(captureChanges.CAPTURE_SMOKE_PATHS).toEqual([
      "src-tauri/src/audio",
      "src-tauri/src/dsp",
      "src-tauri/src/engine",
      "src-tauri/src/harness_main.rs",
      "src-tauri/src/cli_main.rs",
      "src-tauri/src/cli_capture.rs",
      "src-tauri/src/cli_analyze.rs",
      "src-tauri/src/cli_report.rs",
      "scripts/capture-rig.mjs",
      "scripts/smoke-capture.mjs",
    ]);
  });
});
