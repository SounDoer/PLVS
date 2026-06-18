#!/usr/bin/env node
/**
 * Extract the CHANGELOG section for a semver tag (e.g. v0.0.11 -> ## [0.0.11]) to a file for GitHub Releases.
 * Usage: node scripts/changelog-release-body.mjs <tag> <outfile.md>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const tagArg = process.argv[2] ?? "";
const outFile = process.argv[3] ?? "";
const semver = tagArg.replace(/^v/i, "").trim();
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const changelogPath = join(root, "CHANGELOG.md");

if (!semver || !outFile) {
  console.error("Usage: node scripts/changelog-release-body.mjs <tag> <outfile.md>");
  process.exit(1);
}

const changelog = readFileSync(changelogPath, "utf8");
const headerNeedle = `## [${semver}]`;
const idx = changelog.indexOf(headerNeedle);
let body;
if (idx === -1) {
  body = [
    `## PLVS v${semver}`,
    "",
    `See [CHANGELOG.md](https://github.com/SounDoer/PLVS/blob/main/CHANGELOG.md) on \`main\` for the full history.`,
    "",
    "_No dedicated section found for this tag in CHANGELOG.md — add \`## [${semver}]\` before tagging._",
  ].join("\n");
} else {
  const lineEnd = changelog.indexOf("\n", idx);
  const afterHeader =
    lineEnd === -1 ? changelog.slice(idx + headerNeedle.length) : changelog.slice(lineEnd + 1);
  const nextIdx = afterHeader.search(/\n## \[/);
  body = (nextIdx === -1 ? afterHeader : afterHeader.slice(0, nextIdx)).trim();
}

// 固定追加的安装说明（中英文），版本号自动填充。每次发布都会出现在 GitHub Release 页面。
const installSection = [
  "",
  "---",
  "",
  "## 安装",
  "",
  "### Windows",
  `- **安装版**：下载 \`PLVS_${semver}_x64-setup.exe\`，双击运行。`,
  `- **便携版**：下载 \`PLVS-v${semver}-x64-portable.exe\`，直接运行，无需安装。`,
  "- 首次运行时 SmartScreen 可能拦截（未代码签名），点击「更多信息」→「仍要运行」。",
  "",
  "### macOS (Apple Silicon)",
  `- 下载 \`PLVS-v${semver}-aarch64.dmg\`，打开后将 PLVS 拖到「应用程序」。`,
  "- 首次打开若被 Gatekeeper 拦截（未签名），在终端执行：",
  "",
  "```bash",
  "xattr -cr /Applications/PLVS.app",
  "```",
  "",
  "---",
  "",
  "## Installation",
  "",
  "### Windows",
  `- **Installer**: Download \`PLVS_${semver}_x64-setup.exe\` and double-click to run.`,
  `- **Portable**: Download \`PLVS-v${semver}-x64-portable.exe\` and run directly — no installation required.`,
  "- SmartScreen may warn on first launch (unsigned build). Click \"More info\" → \"Run anyway\".",
  "",
  "### macOS (Apple Silicon)",
  `- Download \`PLVS-v${semver}-aarch64.dmg\`, open it and drag PLVS to Applications.`,
  "- If Gatekeeper blocks the app on first open (unsigned build), run in Terminal:",
  "",
  "```bash",
  "xattr -cr /Applications/PLVS.app",
  "```",
  "",
].join("\n");

writeFileSync(outFile, `${body}\n${installSection}\n`, "utf8");
