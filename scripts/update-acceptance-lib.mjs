import { createHash } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

export const ACCEPTANCE_SCHEMA_VERSION = 2;
export const ACCEPTANCE_IDENTITY_PREFIX = "com.soundoer.plvs.updatetest.h";
export const ACCEPTANCE_PRODUCT_PREFIX = "PLVS Update Test ";
export const ACCEPTANCE_WARNING =
  "Isolated acceptance packages; not a stable or Preview release. Do not publish.";
export const DEFAULT_ACCEPTANCE_PORT = 18765;
export const FEED_FAULTS = new Set([
  "valid",
  "stale-signature",
  "wrong-version",
  "truncated-package",
  "manifest-unavailable",
]);

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

function fail(message) {
  throw new Error(`Invalid update acceptance receipt: ${message}`);
}

export function platformDescriptor(platform = process.platform, arch = process.arch) {
  if (platform === "win32" && arch === "x64") {
    return {
      os: "windows",
      arch: "x86_64",
      key: "windows-x86_64",
      packageEndpoint: "/package.exe",
    };
  }
  if (platform === "darwin" && arch === "arm64") {
    return {
      os: "macos",
      arch: "aarch64",
      key: "darwin-aarch64",
      packageEndpoint: "/package.app.tar.gz",
    };
  }
  if (platform === "darwin" && arch === "x64") {
    return {
      os: "macos",
      arch: "x86_64",
      key: "darwin-x86_64",
      packageEndpoint: "/package.app.tar.gz",
    };
  }
  if (platform === "linux" && arch === "x64") {
    return {
      os: "linux",
      arch: "x86_64",
      key: "linux-x86_64-deb",
      packageEndpoint: "/package.deb",
    };
  }
  throw new Error(`Unsupported update acceptance platform: ${platform}/${arch}`);
}

export function acceptanceNames(sourceSha) {
  if (!SHA_PATTERN.test(sourceSha)) throw new Error(`Invalid source SHA: ${sourceSha}`);
  const short = sourceSha.slice(0, 8);
  return {
    short,
    identity: `${ACCEPTANCE_IDENTITY_PREFIX}${short}`,
    productName: `${ACCEPTANCE_PRODUCT_PREFIX}${short}`,
  };
}

// Linux installs updates only for the APT-owned `plvs` package at /usr/bin/plvs (ADR 0034), so its
// acceptance packages keep the stable product and package name and isolate only the identity.
export function acceptanceProductName(sourceSha, os) {
  return os === "linux" ? "PLVS" : acceptanceNames(sourceSha).productName;
}

export function acceptanceVersions(baseVersion) {
  if (!VERSION_PATTERN.test(baseVersion)) {
    throw new Error(`Acceptance requires a three-part numeric version: ${baseVersion}`);
  }
  const [major, minor, patchVersion] = baseVersion.split(".").map(Number);
  return [baseVersion, `${major}.${minor}.${patchVersion + 1}`];
}

export function acceptanceRoot(repository, sourceSha) {
  const { short } = acceptanceNames(sourceSha);
  return path.join(path.resolve(repository), "artifacts", "update-acceptance", short);
}

export function resolveReceiptFile(root, relativeFile) {
  if (typeof relativeFile !== "string" || !relativeFile || path.isAbsolute(relativeFile)) {
    fail("package file must be a non-empty relative path");
  }
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relativeFile);
  if (resolved === resolvedRoot || !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    fail(`package file escapes the acceptance root: ${relativeFile}`);
  }
  return resolved;
}

export function sha256File(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

export function writeJsonAtomic(file, value) {
  const temporary = `${file}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, file);
}

function descriptorForReceiptPlatform(platform) {
  return platformDescriptor(
    platform?.os === "windows" ? "win32" : platform?.os === "macos" ? "darwin" : platform?.os,
    platform?.arch === "x86_64" ? "x64" : platform?.arch === "aarch64" ? "arm64" : platform?.arch
  );
}

export function createAcceptanceReceipt({
  sourceSha,
  platform,
  versions,
  substitutions,
  bundleSigning,
  port = DEFAULT_ACCEPTANCE_PORT,
}) {
  const names = acceptanceNames(sourceSha);
  const descriptor = descriptorForReceiptPlatform(platform);
  return {
    schemaVersion: ACCEPTANCE_SCHEMA_VERSION,
    sourceSha,
    identity: names.identity,
    productName: acceptanceProductName(sourceSha, descriptor.os),
    feed: { host: "127.0.0.1", port },
    platform: { os: descriptor.os, arch: descriptor.arch, key: descriptor.key },
    versions,
    signing: { updater: "ephemeral-minisign", bundle: bundleSigning },
    substitutions,
    warning: ACCEPTANCE_WARNING,
  };
}

export function validateAcceptanceReceipt(receipt, root) {
  if (!receipt || typeof receipt !== "object") fail("receipt must be an object");
  if (receipt.schemaVersion !== ACCEPTANCE_SCHEMA_VERSION) {
    fail(`schemaVersion must be ${ACCEPTANCE_SCHEMA_VERSION}`);
  }
  if (!SHA_PATTERN.test(receipt.sourceSha ?? ""))
    fail("sourceSha must be a full lowercase Git SHA");
  const names = acceptanceNames(receipt.sourceSha);
  if (receipt.identity !== names.identity) fail("identity does not match sourceSha");
  if (receipt.feed?.host !== "127.0.0.1") fail("feed host must be 127.0.0.1");
  if (
    !Number.isInteger(receipt.feed?.port) ||
    receipt.feed.port < 1024 ||
    receipt.feed.port > 65535
  ) {
    fail("feed port must be an integer from 1024 to 65535");
  }
  let descriptor;
  try {
    descriptor = descriptorForReceiptPlatform(receipt.platform);
  } catch (error) {
    fail(error.message);
  }
  if (receipt.platform.key !== descriptor.key) fail("platform key does not match os and arch");
  if (receipt.productName !== acceptanceProductName(receipt.sourceSha, descriptor.os)) {
    fail("productName does not match sourceSha and platform");
  }
  if (!Array.isArray(receipt.versions) || receipt.versions.length !== 2) {
    fail("versions must contain exactly two packages");
  }
  for (const entry of receipt.versions) {
    if (!VERSION_PATTERN.test(entry?.version ?? "")) fail("package version must be x.y.z");
    resolveReceiptFile(root, entry.file);
    if (!HASH_PATTERN.test(entry.sha256 ?? "")) fail("package sha256 must be lowercase hex");
    if (typeof entry.signature !== "string" || !entry.signature.trim()) {
      fail("package signature must be present");
    }
  }
  if (new Set(receipt.versions.map((entry) => entry.version)).size !== 2) {
    fail("package versions must be distinct");
  }
  if (receipt.signing?.updater !== "ephemeral-minisign") {
    fail("updater signing must be ephemeral-minisign");
  }
  if (typeof receipt.signing?.bundle !== "string" || !receipt.signing.bundle) {
    fail("bundle signing mode must be present");
  }
  if (!Array.isArray(receipt.substitutions) || receipt.substitutions.length === 0) {
    fail("substitutions must be a non-empty array");
  }
  if (receipt.warning !== ACCEPTANCE_WARNING) fail("warning is missing or changed");
  return { receipt, descriptor, latest: receipt.versions.at(-1) };
}

export function parseFeedFault(value = "valid") {
  if (!FEED_FAULTS.has(value)) {
    throw new Error(`Unknown feed fault: ${value}. Expected ${[...FEED_FAULTS].join(", ")}`);
  }
  return value;
}

export function acceptanceFeedManifest(receipt, fault = "valid") {
  const selectedFault = parseFeedFault(fault);
  const { descriptor, latest } = validateAcceptanceReceipt(receipt, ".");
  const version =
    selectedFault === "wrong-version" ? acceptanceVersions(latest.version).at(-1) : latest.version;
  const signature =
    selectedFault === "stale-signature" ? `stale-${latest.signature}` : latest.signature;
  return {
    version,
    notes: `# Update Acceptance ${latest.version}\n\n- Verify Offline Installation\n- Restore Workbenches and Dock`,
    platforms: {
      [descriptor.key]: {
        url: `http://${receipt.feed.host}:${receipt.feed.port}${descriptor.packageEndpoint}`,
        signature,
      },
    },
  };
}
