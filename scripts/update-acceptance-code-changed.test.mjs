import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  filterUpdateAcceptancePaths,
  normalizeUpdateAcceptanceContent,
  UPDATE_ACCEPTANCE_PATHS,
  updateAcceptanceChangesSinceLastTag,
} from "./update-acceptance-code-changed.mjs";

describe("update acceptance change classification", () => {
  it("guards the installed updater, signing, packaging, and acceptance chain", () => {
    expect(UPDATE_ACCEPTANCE_PATHS).toEqual(
      expect.arrayContaining([
        "src-tauri/src/update_worker.rs",
        "src-tauri/src/linux_update.rs",
        "src-tauri/linux-update-installer",
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

  it("compares with an explicit baseline commit instead of the last release tag", () => {
    const cwd = mkdtempSync(join(tmpdir(), "plvs-update-since-"));
    try {
      const git = (...args) =>
        execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
          cwd,
          encoding: "utf8",
        }).trim();
      const commit = (file, message) => {
        mkdirSync(join(cwd, file, ".."), { recursive: true });
        writeFileSync(join(cwd, file), message);
        git("add", ".");
        git("commit", "-q", "-m", message);
        return git("rev-parse", "HEAD");
      };
      git("init", "-q");
      commit("README.md", "base");
      git("tag", "v1.0.0");
      commit("src-tauri/src/update_worker.rs", "updater");
      const accepted = commit("README.md", "docs");

      expect(updateAcceptanceChangesSinceLastTag({ cwd }).paths).toEqual([
        "src-tauri/src/update_worker.rs",
      ]);
      expect(updateAcceptanceChangesSinceLastTag({ cwd, since: accepted }).paths).toEqual([]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
