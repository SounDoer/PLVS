import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const config = JSON.parse(read("src-tauri/tauri.linux-deb.conf.json"));
const stableDeb = JSON.parse(read("src-tauri/tauri.linux-stable-deb.conf.json"));
const previewDeb = JSON.parse(read("src-tauri/tauri.linux-preview-deb.conf.json"));
const preview = JSON.parse(read("src-tauri/tauri.preview.conf.json"));
const builder = read("scripts/build-linux-deb.mjs");
const locator = read("src-tauri/src/sidecar.rs");
const packageVerifier = read("scripts/verify-linux-deb.sh");
const desktopVerifier = read("scripts/verify-linux-desktop.py");

describe("Ubuntu package contract", () => {
  it("installs verified decoders in identity-private directories", () => {
    expect(config.bundle.externalBin).toEqual(["binaries/plvs-cli"]);
    expect(config.bundle.linux.deb.depends).not.toContain(expect.stringContaining("ffmpeg"));
    expect(config.bundle.linux.deb.depends).toContain("libc6 (>= 2.39)");
    expect(config.bundle.linux.deb.depends).toContain("libasound2t64");
    expect(config.bundle.linux.deb.depends).toContain("libayatana-appindicator3-1");
    expect(config.bundle.linux.deb.depends).toContain("ca-certificates");
    // Stable and Preview install disjoint paths and coexist (ADR 0036).
    expect(stableDeb.bundle.linux.deb.conflicts).toBeUndefined();
    expect(previewDeb.bundle.linux.deb.conflicts).toBeUndefined();
    expect(stableDeb.bundle.linux.deb.files).toEqual({
      "/usr/lib/plvs/plvs-update-installer": "binaries/plvs-update-installer",
      "/usr/lib/plvs/sidecars/ffmpeg": "binaries/ffmpeg-x86_64-unknown-linux-gnu",
      "/usr/lib/plvs/sidecars/ffprobe": "binaries/ffprobe-x86_64-unknown-linux-gnu",
      "/usr/share/polkit-1/actions/com.soundoer.plvs.update.policy":
        "linux-update-installer/com.soundoer.plvs.update.policy",
    });
    expect(previewDeb.bundle.linux.deb.files).toEqual({
      "/usr/lib/plvs-preview/sidecars/ffmpeg": "binaries/ffmpeg-x86_64-unknown-linux-gnu",
      "/usr/lib/plvs-preview/sidecars/ffprobe": "binaries/ffprobe-x86_64-unknown-linux-gnu",
    });
    expect(locator).toContain('PathBuf::from("/usr/lib").join(package).join("sidecars")');
    expect(locator).not.toContain('PathBuf::from("/usr/bin")');
    expect(builder).toContain('"plvs-update-installer"');
  });

  it("builds stable and Preview with their matching identities and no updater artifacts", () => {
    expect(preview.identifier).toBe("com.soundoer.plvs.preview");
    expect(config.bundle.createUpdaterArtifacts).toBe(false);
    expect(builder).toContain('["stable", "preview"]');
    expect(builder).toContain('"preview-identity"');
    expect(builder).toContain('"src-tauri/tauri.preview.conf.json"');
    expect(builder).toContain('"src-tauri/tauri.linux-deb.conf.json"');
    expect(builder).toContain("tauri.linux-${identity}-deb.conf.json");
    expect(builder).not.toContain("capture-harness");
    expect(builder).not.toContain("dev-identity");
  });

  it("tests installation without distribution FFmpeg and removes the private sidecars", () => {
    expect(packageVerifier).toContain("must not contain system FFmpeg/FFprobe");
    expect(packageVerifier).toContain('local sidecar_dir="/usr/lib/$name/sidecars"');
    expect(packageVerifier).toContain('test ! -e "/usr/lib/$name/sidecars/ffmpeg"');
    expect(packageVerifier).toContain("test ! -e /usr/bin/ffmpeg");
    expect(desktopVerifier).toContain('Path("/usr/lib", package_name, "sidecars")');
    expect(desktopVerifier).not.toContain('run(["ffmpeg"');
    expect(desktopVerifier).not.toContain('run(["ffprobe"');
  });

  it("installs the stable-only privileged updater with its Polkit policy", () => {
    expect(packageVerifier).toContain('update_installer="/usr/lib/plvs/plvs-update-installer"');
    expect(packageVerifier).toContain("com.soundoer.plvs.update.policy");
    expect(previewDeb.bundle.linux.deb.files).not.toHaveProperty(
      "/usr/lib/plvs-preview/plvs-update-installer"
    );
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
    const stable = JSON.parse(read("src-tauri/plvs-agent.json"));
    const previewManifest = JSON.parse(read("src-tauri/plvs-preview-agent.json"));
    expect(stable.cli.relativePath.linux).toBe("usr/bin/plvs-cli");
    expect(previewManifest.cli.relativePath.linux).toBe("usr/bin/plvs-preview-cli");
  });

  it("gives Linux Preview its own executables so it installs beside the stable deb", () => {
    const base = JSON.parse(read("src-tauri/tauri.conf.json"));
    expect(base.mainBinaryName).toBe("plvs");
    expect(previewDeb.mainBinaryName).toBe("plvs-preview");
    expect(previewDeb.bundle.externalBin).toEqual(["binaries/plvs-preview-cli"]);
    expect(stableDeb.mainBinaryName).toBeUndefined();
    expect(builder).toContain("plvs-preview-cli-${cli.targetTriple}");
    // The Rust binaries locate each other by the names their build scripts emit.
    const appBuild = read("src-tauri/build.rs");
    const cliBuild = read("src-tauri/plvs-cli/build.rs");
    expect(appBuild).toContain('("plvs-preview", "plvs-preview-cli")');
    expect(cliBuild).toContain('"plvs-preview"');
    expect(cliBuild).toContain("cargo:rustc-env=PLVS_HOST_BINARY");
    for (const source of ["src-tauri/src/cli_path.rs", "src-tauri/src/doctor.rs"]) {
      expect(read(source)).toContain('env!("PLVS_CLI_BINARY")');
    }
    expect(read("src-tauri/plvs-cli/src/main.rs")).toContain('env!("PLVS_HOST_BINARY")');
    expect(desktopVerifier).toContain('binary, cli = "plvs-preview", "plvs-preview-cli"');
  });

  it("proves stable and Preview coexist in the clean-system verification", () => {
    const cleanRig = read("scripts/verify-linux-deb-clean.sh");
    const workflow = read(".github/workflows/preview-build.yml");
    expect(packageVerifier).toContain('[[ -z $(dpkg-deb -f "$1" Conflicts) ]]');
    expect(packageVerifier).toContain('[[ -z $(dpkg --verify "$name") ]]');
    expect(packageVerifier).toContain(
      'run_desktop "$companion_name" "$output/companion-alongside"'
    );
    expect(packageVerifier).toContain(
      'run_desktop "$companion_name" "$output/companion-after-removal"'
    );
    expect(cleanRig).toContain("[companion.deb]");
    expect(workflow).toContain("npm run desktop:stable-deb");
    expect(workflow).toContain('"${companions[0]}"');
  });
});
