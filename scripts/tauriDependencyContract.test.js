import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
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
const packageJson = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));

describe("Tauri dependency contracts", () => {
  it("confines the Panel host to macOS and the reviewed window factories", () => {
    const macDependencies = cargoToml
      .split("[target.'cfg(target_os = \"macos\")'.dependencies]")[1]
      ?.split("\n[")[0];
    expect(macDependencies).toContain('tauri-nspanel = "=2.1.1"');
    expect(cargoToml.match(/^tauri-nspanel =/gm)).toHaveLength(1);
    expect(cargoToml).not.toContain("vendor/tao");
    expect(cargoToml).not.toContain("[patch.crates-io]");
    const nativeRoot = join(process.cwd(), "src-tauri", "src");
    const constructors = readdirSync(nativeRoot, { recursive: true })
      .filter((file) => file.endsWith(".rs"))
      .filter((file) =>
        /(?:WebviewWindowBuilder|WindowBuilder)::new\(/.test(
          readFileSync(join(nativeRoot, file), "utf8")
        )
      )
      .map((file) => file.replaceAll("\\", "/"))
      .sort();
    expect(constructors).toEqual(["dock_accessories.rs", "lib.rs"]);
  });

  it("keeps the direct window-vibrancy dependency aligned with Tauri", () => {
    expect(cargoToml).toMatch(/window-vibrancy\s*=\s*"0\.8"/);

    const versions = Array.from(
      cargoLock.matchAll(/\[\[package\]\]\r?\nname = "window-vibrancy"\r?\nversion = "([^"]+)"/g),
      (match) => match[1]
    );
    expect(versions).toEqual(["0.8.1"]);
  });

  it("keeps Tauri npm packages on the major/minor release of their crates", () => {
    // `tauri build` refuses mismatched pairs; only package-check in CI runs it.
    const packageLock = JSON.parse(readFileSync(join(process.cwd(), "package-lock.json"), "utf8"));
    const crateVersion = (name) =>
      cargoLock.match(
        new RegExp(`\\[\\[package\\]\\]\\r?\\nname = "${name}"\\r?\\nversion = "([^"]+)"`)
      )?.[1];
    const majorMinor = (version) => version?.split(".").slice(0, 2).join(".");
    const pairs = Object.keys(packageJson.dependencies)
      .filter((name) => name.startsWith("@tauri-apps/"))
      .map((name) => {
        const crate = name === "@tauri-apps/api" ? "tauri" : `tauri-${name.slice(12)}`;
        return {
          name,
          npm: majorMinor(packageLock.packages[`node_modules/${name}`].version),
          crate: majorMinor(crateVersion(crate)),
        };
      });

    expect(pairs.length).toBeGreaterThan(1);
    expect(pairs.filter(({ npm, crate }) => npm !== crate)).toEqual([]);
  });

  it("keeps the Agent Control forwarder isolated from the application crate", () => {
    expect(cargoToml).toMatch(
      /members\s*=\s*\[[^\]]*"linux-update-installer"[^\]]*"plvs-cli"[^\]]*\]/
    );
    expect(cargoToml).toMatch(/exclude\s*=\s*\[[^\]]*"vendor\/voice_activity_detector"[^\]]*\]/);
    expect(cliCargoToml).not.toMatch(/^\[dependencies\]$/m);
    expect(cliCargoToml).not.toMatch(/app_lib|tauri|cpal|voice_activity_detector/);
    expect(desktopControl).toContain('buildPlvsCli({ identity: "dev" })');
  });

  it("keeps manual crash injection out of every shipping desktop command", () => {
    expect(cargoToml).toMatch(/^crash-test\s*=\s*\[\]$/m);
    const shippingCommands = Object.entries(packageJson.scripts)
      .filter(([name]) => name.startsWith("desktop:"))
      .map(([, command]) => command);
    expect(shippingCommands.length).toBeGreaterThan(0);
    for (const command of shippingCommands) {
      expect(command).not.toContain("crash-test");
    }
  });
});
