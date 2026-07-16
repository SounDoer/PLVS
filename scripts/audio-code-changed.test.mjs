import { describe, it, expect } from "vitest";
import { filterAudioPaths, AUDIO_PATHS } from "./audio-code-changed.mjs";

describe("filterAudioPaths", () => {
  it("selects capture, dsp, and engine sources", () => {
    expect(
      filterAudioPaths([
        "src-tauri/src/audio/cpal_backend.rs",
        "src-tauri/src/dsp/loudness.rs",
        "src-tauri/src/engine/meter_pipeline.rs",
      ]),
    ).toHaveLength(3);
  });

  it("ignores frontend and doc changes, which cannot affect the audio thread", () => {
    // The overwhelming majority of this project's commits are dock/UI work.
    // Soaking or smoking those would be pure waste.
    expect(
      filterAudioPaths([
        "src/dock/DockStrip.jsx",
        "docs/cli.md",
        "README.md",
        "src-tauri/src/lib.rs",
      ]),
    ).toEqual([]);
  });

  it("selects a mixed changeset down to only the audio paths", () => {
    expect(
      filterAudioPaths(["src/App.jsx", "src-tauri/src/audio/device_enum.rs", "package.json"]),
    ).toEqual(["src-tauri/src/audio/device_enum.rs"]);
  });

  it("declares the paths it guards", () => {
    expect(AUDIO_PATHS).toEqual([
      "src-tauri/src/audio",
      "src-tauri/src/dsp",
      "src-tauri/src/engine",
    ]);
  });
});
