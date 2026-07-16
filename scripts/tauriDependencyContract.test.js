import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const cargoToml = readFileSync(join(process.cwd(), "src-tauri", "Cargo.toml"), "utf8");
const cargoLock = readFileSync(join(process.cwd(), "src-tauri", "Cargo.lock"), "utf8");

describe("Tauri dependency contracts", () => {
  it("keeps the direct window-vibrancy dependency aligned with Tauri", () => {
    expect(cargoToml).toMatch(/window-vibrancy\s*=\s*"0\.6"/);

    const versions = Array.from(
      cargoLock.matchAll(
        /\[\[package\]\]\r?\nname = "window-vibrancy"\r?\nversion = "([^"]+)"/g
      ),
      (match) => match[1]
    );
    expect(versions).toEqual(["0.6.0"]);
  });
});
