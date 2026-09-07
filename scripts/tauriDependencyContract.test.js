import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const cargoToml = readFileSync(join(process.cwd(), "src-tauri", "Cargo.toml"), "utf8");
const cargoLock = readFileSync(join(process.cwd(), "src-tauri", "Cargo.lock"), "utf8");
const cliCargoToml = readFileSync(
  join(process.cwd(), "src-tauri", "plvs-cli", "Cargo.toml"),
  "utf8"
);
const desktopControl = readFileSync(
  join(process.cwd(), "scripts", "run-desktop-control.mjs"),
  "utf8"
);

describe("Tauri dependency contracts", () => {
  it("keeps the direct window-vibrancy dependency aligned with Tauri", () => {
    expect(cargoToml).toMatch(/window-vibrancy\s*=\s*"0\.6"/);

    const versions = Array.from(
      cargoLock.matchAll(/\[\[package\]\]\r?\nname = "window-vibrancy"\r?\nversion = "([^"]+)"/g),
      (match) => match[1]
    );
    expect(versions).toEqual(["0.6.0"]);
  });

  it("keeps the Agent Control forwarder isolated from the application crate", () => {
    expect(cargoToml).toContain('members = ["plvs-cli"]');
    expect(cargoToml).toContain('exclude = ["vendor/voice_activity_detector"]');
    expect(cliCargoToml).not.toMatch(/^\[dependencies\]$/m);
    expect(cliCargoToml).not.toMatch(/app_lib|tauri|cpal|voice_activity_detector/);
    expect(desktopControl).toContain('const manifestPath = "src-tauri/plvs-cli/Cargo.toml"');
    expect(desktopControl).toContain('"build", "--quiet"');
  });
});
