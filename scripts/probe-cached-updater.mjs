// Builds a disposable signed NSIS fixture. It writes only inside its marked artifacts directory;
// it does not register an app, touch a PLVS installation, or use a release signing key.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

if (process.platform !== "win32") throw new Error("This probe requires Windows NSIS.");
const root = path.resolve("artifacts", "update-controls", `installer-probe-${Date.now()}`);
await mkdir(root, { recursive: true });
await writeFile(path.join(root, "isolated-probe.marker"), "Disposable PLVS updater probe\n");
const nsis = path.join(process.env.LOCALAPPDATA, "tauri", "NSIS", "makensis.exe");
const tauri = path.resolve("node_modules", "@tauri-apps", "cli", "tauri.js");
function run(command, args, env = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    env: { ...process.env, ...env },
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.status !== 0)
    throw new Error(
      `${path.basename(command)} failed: ${result.stderr || result.error || result.status}`
    );
  return result;
}
await writeFile(
  path.join(root, "probe.nsi"),
  `Unicode true
Name "Isolated PLVS Update Probe"
OutFile "${path.join(root, "probe.exe")}"
RequestExecutionLevel user
SilentInstall silent
Section
  StrCmp "$INSTDIR" "${path.join(root, "nondefault installation with spaces")}" approved
  SetErrorLevel 2
  Quit
  approved:
  CreateDirectory "$INSTDIR"
  Sleep 700
  FileOpen $0 "$INSTDIR\\installed-version.txt" w
  FileWrite $0 "2.0.0"
  FileClose $0
  FileOpen $0 "$INSTDIR\\installer-arguments.txt" w
  FileWrite $0 "$CMDLINE"
  FileClose $0
SectionEnd
`
);
run(nsis, ["/V2", path.join(root, "probe.nsi")]);
// Suppress signer output: generation can print the private key. It never belongs in logs.
run(process.execPath, [
  tauri,
  "signer",
  "generate",
  "--ci",
  "--password",
  "",
  "--write-keys",
  path.join(root, "probe.key"),
]);
run(process.execPath, [
  tauri,
  "signer",
  "sign",
  "--private-key-path",
  path.join(root, "probe.key"),
  "--password",
  "",
  "--app-version",
  "2.0.0",
  path.join(root, "probe.exe"),
]);
const result = run(
  "cargo",
  [
    "test",
    "--manifest-path",
    "src-tauri/vendor/tauri-plugin-updater/Cargo.toml",
    "--locked",
    "--target-dir",
    "src-tauri/target/updater-probe",
    "windows_cached_installer_probe",
    "--",
    "--ignored",
    "--nocapture",
  ],
  { PLVS_UPDATER_PROBE_ROOT: root }
);
await writeFile(path.join(root, "result.log"), result.stdout + result.stderr);
console.log(`Passed isolated cached-installer probe: ${root}`);
