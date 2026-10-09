#!/usr/bin/env node
/** Build and run the isolated macOS Accessibility/window-avoidance experiment. */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin") {
  console.error("The Dock reservation probe runs only on macOS.");
  process.exit(1);
}
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const isHost = process.argv[2] === "test-host";
const name = isHost ? "Dock Test Host" : "PLVS Dock Probe";
const identifier = isHost
  ? "com.soundoer.dock-test-host"
  : "com.soundoer.plvs.dock-reservation-probe";
const binary = isHost ? "dock-test-host" : "plvs-dock-probe";
const source = join(root, `scripts/macos/dock-reservation-${isHost ? "host" : "probe"}.swift`);
const output = join(root, "artifacts/macos-dock-reservation");
const bundle = join(output, `${name}.app`);
const contents = join(bundle, "Contents");
const executable = join(contents, `MacOS/${binary}`);
const stamp = join(output, `${binary}-sha256`);
const hash = createHash("sha256").update(readFileSync(source)).digest("hex");
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
if (!existsSync(executable) || !existsSync(stamp) || readFileSync(stamp, "utf8") !== hash) {
  mkdirSync(join(contents, "MacOS"), { recursive: true });
  writeFileSync(
    join(contents, "Info.plist"),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>${binary}</string>
<key>CFBundleIdentifier</key><string>${identifier}</string>
<key>CFBundleName</key><string>${name}</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>1</string>
<key>LSUIElement</key><true/>
<key>LSMinimumSystemVersion</key><string>14.2</string>
</dict></plist>
`
  );
  run("xcrun", ["swiftc", source, "-o", executable]);
  run("codesign", ["--force", "--sign", "-", "--identifier", identifier, bundle]);
  writeFileSync(stamp, hash);
}
// Launch the fixture through LaunchServices so NSRunningApplication supplies its identity
// and launch time. Running the Mach-O directly does not reliably register that metadata.
if (isHost) {
  const args = process.argv
    .slice(3)
    .map((value, index, all) =>
      ["--state", "--control"].includes(all[index - 1]) ? resolve(root, value) : value
    );
  run("open", ["-n", "-W", bundle, "--args", ...args]);
} else run(executable, process.argv.slice(2));
