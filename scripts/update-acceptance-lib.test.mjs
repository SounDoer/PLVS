import { describe, expect, it } from "vitest";

import {
  ACCEPTANCE_WARNING,
  acceptanceFeedManifest,
  acceptanceNames,
  acceptanceVersions,
  createAcceptanceReceipt,
  parseFeedFault,
  platformDescriptor,
  resolveReceiptFile,
  validateAcceptanceReceipt,
} from "./update-acceptance-lib.mjs";

const sourceSha = "0123456789abcdef0123456789abcdef01234567";

function receipt(overrides = {}) {
  return {
    ...createAcceptanceReceipt({
      sourceSha,
      platform: { os: "macos", arch: "aarch64" },
      versions: [
        { version: "0.21.0", file: "0.21.0/app.tar.gz", sha256: "a".repeat(64), signature: "old" },
        { version: "0.21.1", file: "0.21.1/app.tar.gz", sha256: "b".repeat(64), signature: "new" },
      ],
      substitutions: ["identity", "version", "loopback feed"],
      bundleSigning: "ad-hoc",
    }),
    ...overrides,
  };
}

describe("update acceptance contract", () => {
  it("derives isolated names and the next patch version", () => {
    expect(acceptanceNames(sourceSha)).toEqual({
      short: "01234567",
      identity: "com.soundoer.plvs.updatetest.h01234567",
      productName: "PLVS Update Test 01234567",
    });
    expect(acceptanceVersions("0.21.9")).toEqual(["0.21.9", "0.21.10"]);
  });

  it.each([
    ["win32", "x64", "windows-x86_64", "/package.exe"],
    ["darwin", "arm64", "darwin-aarch64", "/package.app.tar.gz"],
    ["darwin", "x64", "darwin-x86_64", "/package.app.tar.gz"],
  ])("maps %s/%s to its updater platform", (platform, arch, key, packageEndpoint) => {
    expect(platformDescriptor(platform, arch)).toMatchObject({ key, packageEndpoint });
  });

  it("rejects unsupported architectures and unsafe package paths", () => {
    expect(() => platformDescriptor("darwin", "ia32")).toThrow(/Unsupported/);
    expect(() => resolveReceiptFile("/tmp/acceptance", "../stable.app")).toThrow(/escapes/);
    expect(() => resolveReceiptFile("/tmp/acceptance", "/Applications/PLVS.app")).toThrow(
      /relative path/
    );
  });

  it("validates a complete isolated receipt", () => {
    const result = validateAcceptanceReceipt(receipt(), "/tmp/acceptance");
    expect(result.descriptor.key).toBe("darwin-aarch64");
    expect(result.latest.version).toBe("0.21.1");
    expect(result.receipt.warning).toBe(ACCEPTANCE_WARNING);
  });

  it.each([
    ["stable identity", { identity: "com.soundoer.plvs" }, /identity/],
    ["remote feed", { feed: { host: "example.com", port: 18765 } }, /127\.0\.0\.1/],
    [
      "wrong platform key",
      { platform: { os: "macos", arch: "aarch64", key: "windows-x86_64" } },
      /platform key/,
    ],
    ["missing warning", { warning: "safe enough" }, /warning/],
  ])("rejects %s", (_label, override, message) => {
    expect(() => validateAcceptanceReceipt(receipt(override), "/tmp/acceptance")).toThrow(message);
  });

  it("generates valid, stale-signature, and wrong-version feed manifests", () => {
    const valid = acceptanceFeedManifest(receipt());
    expect(valid.version).toBe("0.21.1");
    expect(valid.platforms["darwin-aarch64"]).toEqual({
      url: "http://127.0.0.1:18765/package.app.tar.gz",
      signature: "new",
    });
    expect(
      acceptanceFeedManifest(receipt(), "stale-signature").platforms["darwin-aarch64"].signature
    ).toBe("stale-new");
    expect(acceptanceFeedManifest(receipt(), "wrong-version").version).toBe("0.21.2");
  });

  it("accepts only declared feed fault modes", () => {
    expect(parseFeedFault("truncated-package")).toBe("truncated-package");
    expect(() => parseFeedFault("publish-production")).toThrow(/Unknown feed fault/);
  });
});
