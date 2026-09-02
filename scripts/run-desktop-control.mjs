import { spawnSync } from "node:child_process";
import { join } from "node:path";

const manifestPath = "src-tauri/Cargo.toml";
const build = spawnSync(
  "cargo",
  ["build", "--manifest-path", manifestPath, "--features", "dev-identity", "--bin", "plvs-cli"],
  { stdio: "inherit", shell: process.platform === "win32" }
);
if (build.error) {
  console.error(`Unable to build the PLVS development CLI: ${build.error.message}`);
  process.exit(2);
}
if (build.status !== 0) process.exit(build.status ?? 2);

const metadata = spawnSync(
  "cargo",
  ["metadata", "--manifest-path", manifestPath, "--no-deps", "--format-version", "1"],
  { encoding: "utf8", shell: process.platform === "win32" }
);
if (metadata.error || metadata.status !== 0) {
  if (metadata.stderr) process.stderr.write(metadata.stderr);
  console.error("Unable to locate the PLVS Cargo target directory.");
  process.exit(2);
}

let targetDirectory;
try {
  targetDirectory = JSON.parse(metadata.stdout).target_directory;
} catch (error) {
  console.error(`Unable to read Cargo metadata: ${error.message}`);
  process.exit(2);
}
const executable = join(
  targetDirectory,
  "debug",
  process.platform === "win32" ? "plvs-cli.exe" : "plvs-cli"
);
const child = spawnSync(executable, ["app", ...process.argv.slice(2)], { stdio: "inherit" });
if (child.error) {
  console.error(`Unable to launch the PLVS development CLI: ${child.error.message}`);
  process.exit(2);
}
process.exit(child.status ?? 2);
