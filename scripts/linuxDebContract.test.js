import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const config = JSON.parse(read("src-tauri/tauri.linux-deb.conf.json"));
const preview = JSON.parse(read("src-tauri/tauri.preview.conf.json"));
const builder = read("scripts/build-linux-deb.mjs");

describe("Ubuntu Preview package contract", () => {
  it("uses APT decoders without overwriting the distribution's binaries", () => {
    expect(config.bundle.externalBin).toEqual(["binaries/plvs-cli"]);
    expect(config.bundle.linux.deb.depends).toContain("ffmpeg (>= 7:6.1)");
    expect(config.bundle.linux.deb.depends).toContain("libc6 (>= 2.39)");
    expect(config.bundle.linux.deb.depends).toContain("libasound2t64");
    expect(config.bundle.linux.deb.depends).toContain("libayatana-appindicator3-1");
    expect(config.bundle.linux.deb.depends).toContain("ca-certificates");
    expect(config.bundle.linux.deb.conflicts).toContain("plvs");
  });

  it("builds both executables with the isolated Preview identity and no updater artifacts", () => {
    expect(preview.identifier).toBe("com.soundoer.plvs.preview");
    expect(config.bundle.createUpdaterArtifacts).toBe(false);
    expect(builder).toContain('identity: "preview"');
    expect(builder).toContain('"preview-identity"');
    expect(builder).toContain('"src-tauri/tauri.preview.conf.json"');
    expect(builder).toContain('"src-tauri/tauri.linux-deb.conf.json"');
    expect(builder).not.toContain("capture-harness");
    expect(builder).not.toContain("dev-identity");
  });

  it("deletes the stable manifest key when Tauri combines the configuration patches", () => {
    const reset = JSON.parse(read("src-tauri/tauri.clear-resources.conf.json"));
    expect(reset.bundle.resources).toEqual({ "plvs-agent.json": null });
    expect(builder.indexOf("tauri.clear-resources.conf.json")).toBeLessThan(
      builder.indexOf("tauri.preview.conf.json")
    );
    const installedPaths = Object.values(preview.bundle.resources);
    expect(new Set(installedPaths).size).toBe(installedPaths.length);
    expect(preview.bundle.resources["plvs-preview-agent.json"]).toBe("plvs-agent.json");
    expect(preview.bundle.resources["plvs-agent.json"]).toBeUndefined();
    // The deletion must survive combining all CLI patches, before they reach the base config.
    const combinedResources = { ...reset.bundle.resources, ...preview.bundle.resources };
    expect(combinedResources["plvs-agent.json"]).toBeNull();
    const base = JSON.parse(read("src-tauri/tauri.conf.json"));
    const resolvedResources = Object.fromEntries(
      Object.entries({ ...base.bundle.resources, ...combinedResources }).filter(
        ([, destination]) => destination !== null
      )
    );
    expect(
      Object.values(resolvedResources).filter((path) => path === "plvs-agent.json")
    ).toHaveLength(1);
  });

  it("provides the installed Linux CLI path in both generated discovery manifests", () => {
    for (const name of ["plvs-agent", "plvs-preview-agent"]) {
      const manifest = JSON.parse(read(`src-tauri/${name}.json`));
      expect(manifest.cli.relativePath.linux).toBe("usr/bin/plvs-cli");
    }
  });
});
