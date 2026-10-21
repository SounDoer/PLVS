#!/usr/bin/env node
// Build two real packages from one exact source snapshot. Identity, version, key, and endpoint
// substitutions occur only below ignored artifacts/update-acceptance/, never in shipping sources.
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  acceptanceNames,
  acceptanceProductName,
  acceptanceRoot,
  acceptanceVersions,
  createAcceptanceReceipt,
  platformDescriptor,
  sha256File,
  validateAcceptanceReceipt,
  writeJsonAtomic,
} from "./update-acceptance-lib.mjs";

export function run(command, args, { cwd, env = {}, log, quiet = false } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
    stdio: quiet ? "pipe" : ["ignore", "pipe", "pipe"],
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (log) writeFileSync(log, output);
  if (result.error) throw new Error(`${command} could not start: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`${command} failed with status ${result.status}; ${log ?? output.trim()}`);
  }
  return (result.stdout ?? "").trim();
}

export function assertCommittedSource(repository, invoke = run) {
  const status = invoke("git", ["status", "--porcelain", "--untracked-files=all"], {
    cwd: repository,
    quiet: true,
  });
  if (status) {
    throw new Error(
      "Update acceptance requires a clean worktree so every package matches the recorded HEAD."
    );
  }
  return invoke("git", ["rev-parse", "HEAD"], { cwd: repository, quiet: true });
}

export function acceptanceBuildLayout({ repository, sourceSha, platform, arch }) {
  const descriptor = platformDescriptor(platform, arch);
  const names = {
    ...acceptanceNames(sourceSha),
    productName: acceptanceProductName(sourceSha, descriptor.os),
  };
  const root = acceptanceRoot(repository, sourceSha);
  return {
    descriptor,
    names,
    root,
    snapshot: path.join(root, "source"),
    target: path.join(root, "target"),
    key: path.join(root, "acceptance.key"),
    receipt: path.join(root, "acceptance.json"),
  };
}

function replaceExactlyOnce(source, needle, replacement, label) {
  if (source.split(needle).length !== 2) throw new Error(`${label} seam changed`);
  return source.replace(needle, replacement);
}

export function replaceCargoWorkspaceVersion(source, version) {
  const pattern = /(\[workspace\.package\]\s+version = )"[^"]+"/;
  if (!pattern.test(source)) throw new Error("Cargo workspace version seam changed");
  return source.replace(pattern, `$1"${version}"`);
}

function prepareSnapshot(
  { repository, sourceSha, root, snapshot, names, descriptor },
  invoke = run
) {
  const marker = path.join(root, "snapshot.json");
  if (existsSync(path.join(snapshot, "package.json"))) {
    if (!existsSync(marker))
      throw new Error(`Existing acceptance snapshot has no marker: ${snapshot}`);
    const saved = JSON.parse(readFileSync(marker, "utf8"));
    if (
      saved.sourceSha !== sourceSha ||
      saved.platformKey !== descriptor.key ||
      saved.identity !== names.identity
    ) {
      throw new Error(`Existing acceptance snapshot does not match ${sourceSha}/${descriptor.key}`);
    }
    return;
  }

  mkdirSync(snapshot, { recursive: true });
  const archive = path.join(root, "source.tar");
  invoke("git", ["archive", "--format=tar", `--output=${archive}`, sourceSha], {
    cwd: repository,
    quiet: true,
  });
  // GNU tar treats a Windows drive-letter path as a remote archive (`C:...`). Keep every
  // extraction path relative to the acceptance root so the same command works in Git Bash.
  invoke("tar", ["-xf", "source.tar", "-C", "source"], { cwd: root, quiet: true });
  symlinkSync(
    path.join(repository, "node_modules"),
    path.join(snapshot, "node_modules"),
    process.platform === "win32" ? "junction" : "dir"
  );

  if (descriptor.os === "windows") {
    const runtime = path.join(snapshot, "src-tauri/src/update_runtime.rs");
    const registryName = names.productName;
    writeFileSync(
      runtime,
      replaceExactlyOnce(
        readFileSync(runtime, "utf8"),
        'r"Software\\SounDoer\\PLVS"',
        `r"Software\\SounDoer\\${registryName}"`,
        "Windows installation identity"
      )
    );
    const generator = path.join(snapshot, "scripts/generate-agent-discovery.mjs");
    writeFileSync(
      generator,
      replaceExactlyOnce(
        readFileSync(generator, "utf8"),
        'nsisDefinesFor(tauriConfig, "PLVS")',
        `nsisDefinesFor(tauriConfig, ${JSON.stringify(registryName)})`,
        "Windows Agent discovery identity"
      )
    );
  }
  writeJsonAtomic(marker, {
    schemaVersion: 1,
    sourceSha,
    platformKey: descriptor.key,
    identity: names.identity,
  });
}

function generateKey({ repository, root, key }, invoke = run) {
  if (existsSync(key) && existsSync(`${key}.pub`)) return;
  const tauri = path.join(repository, "node_modules", "@tauri-apps", "cli", "tauri.js");
  mkdirSync(root, { recursive: true });
  // The signer can print private material. Capture and discard it rather than forwarding to logs.
  invoke(
    process.execPath,
    [tauri, "signer", "generate", "--ci", "--password", "", "--write-keys", key],
    { cwd: repository, quiet: true }
  );
}

function writeVersion(snapshot, version, names, key, descriptor) {
  const packagePath = path.join(snapshot, "package.json");
  const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
  packageJson.version = version;
  writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);

  const cargoPath = path.join(snapshot, "src-tauri/Cargo.toml");
  const cargo = readFileSync(cargoPath, "utf8");
  writeFileSync(cargoPath, replaceCargoWorkspaceVersion(cargo, version));

  const configPath = path.join(snapshot, "src-tauri/tauri.conf.json");
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  Object.assign(config, {
    productName: names.productName,
    identifier: names.identity,
    version,
  });
  config.bundle.createUpdaterArtifacts = false;
  config.build.beforeBuildCommand = "";
  config.plugins.updater = {
    requireSignedVersion: true,
    dangerousInsecureTransportProtocol: true,
    pubkey: readFileSync(`${key}.pub`, "utf8").trim(),
    endpoints: ["http://127.0.0.1:18765/latest.json"],
  };
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

  if (descriptor.os === "windows") {
    const windowsPath = path.join(snapshot, "src-tauri/tauri.windows.conf.json");
    const windows = JSON.parse(readFileSync(windowsPath, "utf8"));
    windows.bundle.windows.nsis.compression = "zlib";
    writeFileSync(windowsPath, `${JSON.stringify(windows, null, 2)}\n`);
  }
}

function copyPlatformSidecars(repository, snapshot, descriptor) {
  const source = path.join(repository, "src-tauri/binaries");
  const destination = path.join(snapshot, "src-tauri/binaries");
  mkdirSync(destination, { recursive: true });
  const suffix = platformTargetTriple(descriptor);
  const extension = descriptor.os === "windows" ? ".exe" : "";
  for (const tool of ["ffmpeg", "ffprobe"]) {
    const name = `${tool}-${suffix}${extension}`;
    const from = path.join(source, name);
    if (!existsSync(from)) throw new Error(`Missing acceptance sidecar: ${from}`);
    copyFileSync(from, path.join(destination, name));
    if (descriptor.os !== "windows") chmodSync(path.join(destination, name), 0o755);
  }
}

export function platformTargetTriple(descriptor) {
  if (descriptor.os === "windows" && descriptor.arch === "x86_64") {
    return "x86_64-pc-windows-msvc";
  }
  if (descriptor.os === "macos" && descriptor.arch === "aarch64") {
    return "aarch64-apple-darwin";
  }
  if (descriptor.os === "macos" && descriptor.arch === "x86_64") {
    return "x86_64-apple-darwin";
  }
  if (descriptor.os === "linux" && descriptor.arch === "x86_64") {
    return "x86_64-unknown-linux-gnu";
  }
  throw new Error(`Unsupported acceptance target: ${descriptor.os}/${descriptor.arch}`);
}

export function macUpdaterArchiveCommand(app, updater, out) {
  return {
    args: ["-czf", updater, "-C", out, path.basename(app)],
    env: { COPYFILE_DISABLE: "1" },
  };
}

function buildFrontend({ repository, snapshot, descriptor, out }, invoke = run) {
  invoke(process.execPath, [path.join(repository, "node_modules/vite/bin/vite.js"), "build"], {
    cwd: snapshot,
    env: { TAURI_ENV_PLATFORM: descriptor.os },
    log: path.join(out, "frontend.log"),
  });
  invoke(process.execPath, ["scripts/generate-agent-discovery.mjs"], { cwd: snapshot });
}

function buildCli({ snapshot, target, descriptor, out }, invoke = run) {
  invoke(
    "cargo",
    ["build", "--manifest-path", "src-tauri/plvs-cli/Cargo.toml", "--target-dir", target],
    { cwd: snapshot, log: path.join(out, "cli.log") }
  );
  const extension = descriptor.os === "windows" ? ".exe" : "";
  const triple = platformTargetTriple(descriptor);
  const destination = path.join(snapshot, "src-tauri/binaries", `plvs-cli-${triple}${extension}`);
  copyFileSync(path.join(target, "debug", `plvs-cli${extension}`), destination);
  if (descriptor.os !== "windows") chmodSync(destination, 0o755);
}

function signUpdater({ repository, key, version, file }, invoke = run) {
  const tauri = path.join(repository, "node_modules", "@tauri-apps", "cli", "tauri.js");
  invoke(
    process.execPath,
    [
      tauri,
      "signer",
      "sign",
      "--private-key-path",
      key,
      "--password",
      "",
      "--app-version",
      version,
      file,
    ],
    { cwd: repository, quiet: true }
  );
}

function buildWindowsPackage(context, version, out, invoke = run) {
  const { repository, snapshot, target, names, key } = context;
  const installer = path.join(out, `PLVS-Update-Test_${version}_x64-setup.exe`);
  if (!existsSync(installer)) {
    buildFrontend({ ...context, out }, invoke);
    buildCli({ ...context, out }, invoke);
    const tauri = path.join(repository, "node_modules", "@tauri-apps", "cli", "tauri.js");
    invoke(
      process.execPath,
      [
        tauri,
        "build",
        "--debug",
        "--bundles",
        "nsis",
        "--config",
        "src-tauri/tauri.cli-sidecar.conf.json",
      ],
      { cwd: snapshot, env: { CARGO_TARGET_DIR: target }, log: path.join(out, "bundle.log") }
    );
    copyFileSync(
      path.join(target, "debug/bundle/nsis", `${names.productName}_${version}_x64-setup.exe`),
      installer
    );
    signUpdater({ repository, key, version, file: installer }, invoke);
  }
  return { file: installer, bundleSigning: "unsigned-test-nsis" };
}

function buildMacPackage(context, version, out, invoke = run) {
  const { repository, snapshot, target, names, key } = context;
  const app = path.join(out, `${names.productName}.app`);
  const updater = path.join(
    out,
    `${names.productName}_${version}_${context.descriptor.arch}.app.tar.gz`
  );
  const dmg = path.join(out, `${names.productName}_${version}_${context.descriptor.arch}.dmg`);
  const signingIdentity = process.env.PLVS_UPDATE_ACCEPTANCE_MACOS_SIGNING_IDENTITY || "-";
  if (!existsSync(updater)) {
    buildFrontend({ ...context, out }, invoke);
    buildCli({ ...context, out }, invoke);
    const tauri = path.join(repository, "node_modules", "@tauri-apps", "cli", "tauri.js");
    invoke(
      process.execPath,
      [
        tauri,
        "build",
        "--debug",
        "--bundles",
        "app",
        "--config",
        "src-tauri/tauri.cli-sidecar.conf.json",
      ],
      { cwd: snapshot, env: { CARGO_TARGET_DIR: target }, log: path.join(out, "bundle.log") }
    );
    cpSync(path.join(target, "debug/bundle/macos", `${names.productName}.app`), app, {
      recursive: true,
    });
    invoke("codesign", ["--force", "--deep", "--sign", signingIdentity, app], {
      cwd: repository,
      log: path.join(out, "codesign.log"),
    });
    invoke("codesign", ["--verify", "--deep", "--strict", "--verbose=2", app], {
      cwd: repository,
      log: path.join(out, "codesign-verify.log"),
    });
    const archive = macUpdaterArchiveCommand(app, updater, out);
    invoke("tar", archive.args, {
      cwd: repository,
      env: archive.env,
      quiet: true,
    });
    invoke(
      "hdiutil",
      ["create", "-volname", names.productName, "-srcfolder", app, "-ov", "-format", "UDZO", dmg],
      { cwd: repository, log: path.join(out, "dmg.log") }
    );
    signUpdater({ repository, key, version, file: updater }, invoke);
  }
  return {
    file: updater,
    app,
    dmg,
    bundleSigning: signingIdentity === "-" ? "ad-hoc" : "test-certificate",
  };
}

// The stable deb layout (scripts/build-linux-deb.mjs): the CLI as a sidecar, FFmpeg and the
// privileged update installer under /usr/lib/plvs, and the Polkit action beside them.
export function linuxDebBundleArgs(tauri) {
  return [
    tauri,
    "build",
    "--debug",
    "--bundles",
    "deb",
    "--config",
    "src-tauri/tauri.linux-deb.conf.json",
    "--config",
    "src-tauri/tauri.linux-stable-deb.conf.json",
  ];
}

function buildLinuxPackage(context, version, out, invoke = run) {
  const { repository, snapshot, target, names, key } = context;
  const deb = path.join(out, `${names.productName}_${version}_amd64.deb`);
  if (!existsSync(deb)) {
    buildFrontend({ ...context, out }, invoke);
    buildCli({ ...context, out }, invoke);
    // build.rs embeds the snapshot's updater key, so this installer trusts only the ephemeral key.
    invoke(
      "cargo",
      [
        "build",
        "--manifest-path",
        "src-tauri/linux-update-installer/Cargo.toml",
        "--target-dir",
        target,
      ],
      { cwd: snapshot, log: path.join(out, "installer.log") }
    );
    const installer = path.join(snapshot, "src-tauri/binaries/plvs-update-installer");
    copyFileSync(path.join(target, "debug", "plvs-update-installer"), installer);
    chmodSync(installer, 0o755);
    const tauri = path.join(repository, "node_modules", "@tauri-apps", "cli", "tauri.js");
    invoke(process.execPath, linuxDebBundleArgs(tauri), {
      cwd: snapshot,
      env: { CARGO_TARGET_DIR: target },
      log: path.join(out, "bundle.log"),
    });
    copyFileSync(
      path.join(target, "debug/bundle/deb", `${names.productName}_${version}_amd64.deb`),
      deb
    );
    signUpdater({ repository, key, version, file: deb }, invoke);
  }
  return { file: deb, bundleSigning: "unsigned-test-deb" };
}

export function buildUpdateAcceptance({ repository = process.cwd(), invoke = run } = {}) {
  const sourceSha = assertCommittedSource(repository, invoke);
  const layout = acceptanceBuildLayout({
    repository,
    sourceSha,
    platform: process.platform,
    arch: process.arch,
  });
  const context = { repository, sourceSha, ...layout };
  mkdirSync(context.root, { recursive: true });
  generateKey(context, invoke);
  prepareSnapshot(context, invoke);
  copyPlatformSidecars(repository, context.snapshot, context.descriptor);

  const baseVersion = JSON.parse(
    readFileSync(path.join(repository, "package.json"), "utf8")
  ).version;
  const versions = [];
  let bundleSigning = null;
  for (const version of acceptanceVersions(baseVersion)) {
    const out = path.join(context.root, version);
    mkdirSync(out, { recursive: true });
    writeVersion(context.snapshot, version, context.names, context.key, context.descriptor);
    console.log(
      `Building ${version} from ${sourceSha} for ${context.descriptor.key} with ${context.names.identity}`
    );
    const builder = {
      windows: buildWindowsPackage,
      macos: buildMacPackage,
      linux: buildLinuxPackage,
    }[context.descriptor.os];
    const built = builder(context, version, out, invoke);
    bundleSigning ??= built.bundleSigning;
    if (bundleSigning !== built.bundleSigning)
      throw new Error("Bundle signing mode changed mid-build");
    const entry = {
      version,
      file: path.relative(context.root, built.file).replaceAll("\\", "/"),
      sha256: sha256File(built.file),
      signature: readFileSync(`${built.file}.sig`, "utf8").trim(),
    };
    if (built.app) entry.app = path.relative(context.root, built.app).replaceAll("\\", "/");
    if (built.dmg) {
      entry.dmg = path.relative(context.root, built.dmg).replaceAll("\\", "/");
      entry.dmgSha256 = sha256File(built.dmg);
    }
    versions.push(entry);
  }

  const receipt = createAcceptanceReceipt({
    sourceSha,
    platform: context.descriptor,
    versions,
    substitutions: {
      windows: [
        "application identity and registry namespace",
        "version",
        "ephemeral signing key and loopback-only HTTP feed",
        "debug profile with embedded frontend; zlib installer compression",
      ],
      macos: [
        "application identity and bundle identifier",
        "version",
        "ephemeral signing key and loopback-only HTTP feed",
        "debug profile with embedded frontend; isolated app, DMG, and updater archive",
      ],
      linux: [
        "application identity only; the stable plvs package and its fixed system paths are kept (ADR 0038)",
        "version",
        "ephemeral signing key, also embedded in the privileged update installer, and loopback-only HTTP feed",
        "debug profile with embedded frontend; installed through APT on the runner and restored afterwards",
      ],
    }[context.descriptor.os],
    bundleSigning,
  });
  validateAcceptanceReceipt(receipt, context.root);
  writeJsonAtomic(context.receipt, receipt);
  console.log(`Acceptance packages ready: ${context.root}`);
  return { root: context.root, receipt };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    buildUpdateAcceptance();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
