import { describe, expect, it } from "vitest";

import {
  filterUpdateAcceptancePaths,
  normalizeUpdateAcceptanceContent,
  UPDATE_ACCEPTANCE_PATHS,
} from "./update-acceptance-code-changed.mjs";

describe("update acceptance change classification", () => {
  it("guards the installed updater, signing, packaging, and acceptance chain", () => {
    expect(UPDATE_ACCEPTANCE_PATHS).toEqual(
      expect.arrayContaining([
        "src-tauri/src/update_worker.rs",
        "src-tauri/vendor/tauri-plugin-updater",
        "src-tauri/tauri.windows.conf.json",
        "scripts/prepare-macos-signing.sh",
        ".github/workflows/release.yml",
        "scripts/run-release-gate.mjs",
      ])
    );
    expect(
      filterUpdateAcceptancePaths([
        "src-tauri/vendor/tauri-plugin-updater/src/updater.rs",
        "scripts/run-update-acceptance.mjs",
        "src/components/LevelMeter.jsx",
      ])
    ).toEqual([
      "src-tauri/vendor/tauri-plugin-updater/src/updater.rs",
      "scripts/run-update-acceptance.mjs",
    ]);
  });

  it("does not turn ordinary version and UI changes into an every-release gate", () => {
    expect(
      filterUpdateAcceptancePaths([
        "package.json",
        "src-tauri/Cargo.toml",
        "src-tauri/tauri.conf.json",
        "src-tauri/nsis/installer-hooks.nsh",
        "src/components/UpdateDetailsContent.jsx",
      ])
    ).toEqual([]);
  });

  it("guards updater configuration and installer hooks without treating version stamps as logic", () => {
    const config = (version, endpoint) =>
      JSON.stringify({
        version,
        identifier: "com.soundoer.plvs",
        bundle: { active: true, createUpdaterArtifacts: true },
        plugins: { updater: { endpoints: [endpoint], pubkey: "public-key" } },
      });
    expect(
      normalizeUpdateAcceptanceContent("src-tauri/tauri.conf.json", config("1.0.0", "feed"))
    ).toBe(normalizeUpdateAcceptanceContent("src-tauri/tauri.conf.json", config("1.0.1", "feed")));
    expect(
      normalizeUpdateAcceptanceContent("src-tauri/tauri.conf.json", config("1.0.0", "feed-a"))
    ).not.toBe(
      normalizeUpdateAcceptanceContent("src-tauri/tauri.conf.json", config("1.0.0", "feed-b"))
    );
    expect(
      normalizeUpdateAcceptanceContent(
        "src-tauri/nsis/installer-hooks.nsh",
        '!define PLVS_AGENT_VERSION "1.0.0"\n!macro NSIS_HOOK_POSTINSTALL\n!macroend\n'
      )
    ).toBe(
      normalizeUpdateAcceptanceContent(
        "src-tauri/nsis/installer-hooks.nsh",
        '!define PLVS_AGENT_VERSION "1.0.1"\n!macro NSIS_HOOK_POSTINSTALL\n!macroend\n'
      )
    );
  });
});
