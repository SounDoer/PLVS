// Build two real NSIS packages from an exact source snapshot. Test identity/key/endpoint
// substitutions occur only in the ignored snapshot, never in shipping sources or config.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

if (process.platform !== "win32") throw new Error("Windows acceptance build only");
const repository = process.cwd();
const run = (command, args, cwd = repository, env = {}, log) => {
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (log) writeFileSync(log, result.stdout + result.stderr);
  if (result.status !== 0) throw new Error(`${command} failed; ${log ?? result.stderr}`);
  return result.stdout.trim();
};
const sha = run("git", ["rev-parse", "HEAD"]);
const short = sha.slice(0, 8);
const root = path.join(repository, "artifacts", "update-acceptance", short);
const snapshot = path.join(root, "source");
const identity = `com.soundoer.plvs.updatetest.h${short}`;
const productName = `PLVS Update Test ${short}`;
const registryName = productName;
const port = 18765;
const target = path.join(repository, "src-tauri", "target");
const tauri = path.join(repository, "node_modules", "@tauri-apps", "cli", "tauri.js");
mkdirSync(snapshot, { recursive: true });
if (!existsSync(path.join(snapshot, "package.json"))) {
  run("git", ["archive", "--format=tar", `--output=${path.join(root, "source.tar")}`, sha]);
  run("tar", ["-xf", path.join(root, "source.tar"), "-C", snapshot]);
  symlinkSync(
    path.join(repository, "node_modules"),
    path.join(snapshot, "node_modules"),
    "junction"
  );
  // The runtime uses the same installed-directory evidence, scoped to this disposable app.
  const runtime = path.join(snapshot, "src-tauri/src/update_runtime.rs");
  const source = readFileSync(runtime, "utf8");
  const needle = 'r"Software\\SounDoer\\PLVS"';
  if (source.split(needle).length !== 2) throw new Error("Installation identity seam changed");
  writeFileSync(runtime, source.replace(needle, `r"Software\\SounDoer\\${registryName}"`));
  const generator = path.join(snapshot, "scripts/generate-agent-discovery.mjs");
  writeFileSync(
    generator,
    readFileSync(generator, "utf8").replace(
      'nsisDefinesFor(tauriConfig, "PLVS")',
      `nsisDefinesFor(tauriConfig, ${JSON.stringify(registryName)})`
    )
  );
}
const key = path.join(root, "acceptance.key");
if (!existsSync(key)) {
  // Signer generation can print private material: deliberately capture and discard its output.
  run(process.execPath, [
    tauri,
    "signer",
    "generate",
    "--ci",
    "--password",
    "",
    "--write-keys",
    key,
  ]);
}
const baseVersion = JSON.parse(readFileSync(path.join(repository, "package.json"), "utf8")).version;
const parts = baseVersion.split(".").map(Number);
const versions = [baseVersion, `${parts[0]}.${parts[1]}.${parts[2] + 1}`];
const artifacts = [];
for (const version of versions) {
  const out = path.join(root, version);
  mkdirSync(out, { recursive: true });
  const installer = path.join(out, `PLVS-Update-Test_${version}_x64-setup.exe`);
  if (!existsSync(installer)) {
    const pkg = JSON.parse(readFileSync(path.join(snapshot, "package.json"), "utf8"));
    pkg.version = version;
    writeFileSync(path.join(snapshot, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
    const cargo = path.join(snapshot, "src-tauri/Cargo.toml");
    writeFileSync(
      cargo,
      readFileSync(cargo, "utf8").replace(
        /(\[workspace\.package\]\s+version = )"[^"]+"/,
        `$1"${version}"`
      )
    );
    const configPath = path.join(snapshot, "src-tauri/tauri.conf.json");
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    Object.assign(config, { productName, identifier: identity, version });
    config.bundle.createUpdaterArtifacts = false;
    config.build.beforeBuildCommand = "";
    config.plugins.updater = {
      requireSignedVersion: true,
      dangerousInsecureTransportProtocol: true,
      pubkey: readFileSync(key + ".pub", "utf8").trim(),
      endpoints: [`http://127.0.0.1:${port}/latest.json`],
    };
    writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
    const windowsPath = path.join(snapshot, "src-tauri/tauri.windows.conf.json");
    const windows = JSON.parse(readFileSync(windowsPath, "utf8"));
    windows.bundle.windows.nsis.compression = "zlib";
    writeFileSync(windowsPath, JSON.stringify(windows, null, 2) + "\n");
    const binaries = path.join(snapshot, "src-tauri/binaries");
    mkdirSync(binaries, { recursive: true });
    for (const name of readdirSync(path.join(repository, "src-tauri/binaries"))) {
      if (/^(ffmpeg|ffprobe)-.*\.exe$/.test(name))
        copyFileSync(path.join(repository, "src-tauri/binaries", name), path.join(binaries, name));
    }
    console.log(`Building ${version} from ${sha} with isolated identity ${identity}`);
    run(
      process.execPath,
      [path.join(repository, "node_modules/vite/bin/vite.js"), "build"],
      snapshot,
      { TAURI_ENV_PLATFORM: "windows" },
      path.join(out, "frontend.log")
    );
    run(process.execPath, ["scripts/generate-agent-discovery.mjs"], snapshot);
    run(
      "cargo",
      ["build", "--manifest-path", "src-tauri/plvs-cli/Cargo.toml", "--target-dir", target],
      snapshot,
      {},
      path.join(out, "cli.log")
    );
    copyFileSync(
      path.join(target, "debug/plvs-cli.exe"),
      path.join(binaries, "plvs-cli-x86_64-pc-windows-msvc.exe")
    );
    run(
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
      snapshot,
      { CARGO_TARGET_DIR: target },
      path.join(out, "bundle.log")
    );
    copyFileSync(
      path.join(target, "debug/bundle/nsis", `${productName}_${version}_x64-setup.exe`),
      installer
    );
    run(process.execPath, [
      tauri,
      "signer",
      "sign",
      "--private-key-path",
      key,
      "--password",
      "",
      "--app-version",
      version,
      installer,
    ]);
  }
  artifacts.push({
    version,
    file: path.relative(root, installer).replaceAll("\\", "/"),
    sha256: createHash("sha256").update(readFileSync(installer)).digest("hex"),
    signature: readFileSync(installer + ".sig", "utf8").trim(),
  });
  writeFileSync(
    path.join(root, "acceptance.json"),
    JSON.stringify(
      {
        sha,
        identity,
        productName,
        registryName,
        port,
        artifacts,
        substitutions: [
          "application identity and registry namespace",
          "version",
          "ephemeral signing key and loopback-only HTTP feed",
          "debug profile with embedded frontend; zlib installer compression",
        ],
        warning: "Isolated acceptance packages; not a stable or Preview release. Do not publish.",
      },
      null,
      2
    ) + "\n"
  );
}
console.log(`Acceptance installers ready: ${root}`);
