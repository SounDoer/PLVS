import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createAcceptanceReceipt, sha256File } from "./update-acceptance-lib.mjs";
import { createAcceptanceFeed, parseServeArguments } from "./serve-update-acceptance.mjs";

const servers = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((server) => new Promise((resolve) => server.close(() => resolve())))
  );
});

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "plvs-update-feed-"));
  const oldFile = path.join(root, "0.21.0", "package.app.tar.gz");
  const newFile = path.join(root, "0.21.1", "package.app.tar.gz");
  mkdirSync(path.dirname(oldFile), { recursive: true });
  mkdirSync(path.dirname(newFile), { recursive: true });
  writeFileSync(oldFile, "old-package");
  writeFileSync(newFile, "complete-new-package");
  const receipt = createAcceptanceReceipt({
    sourceSha: "0123456789abcdef0123456789abcdef01234567",
    platform: { os: "macos", arch: "aarch64" },
    versions: [
      {
        version: "0.21.0",
        file: path.relative(root, oldFile),
        sha256: sha256File(oldFile),
        signature: "old-signature",
      },
      {
        version: "0.21.1",
        file: path.relative(root, newFile),
        sha256: sha256File(newFile),
        signature: "new-signature",
      },
    ],
    substitutions: ["identity", "version", "loopback feed"],
    bundleSigning: "ad-hoc",
    port: 18765,
  });
  writeFileSync(path.join(root, "acceptance.json"), JSON.stringify(receipt));
  return { root, packageBytes: readFileSync(newFile) };
}

async function listen(root, fault = "valid") {
  const server = createAcceptanceFeed({ root, fault });
  servers.push(server);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

describe("update acceptance feed", () => {
  it("parses one isolated root and a declared fault", () => {
    expect(parseServeArguments(["artifacts/test", "--fault", "wrong-version"])).toMatchObject({
      fault: "wrong-version",
    });
    expect(() => parseServeArguments(["--fault", "valid"])).toThrow(/Usage/);
  });

  it("serves the host platform manifest and complete package", async () => {
    const { root, packageBytes } = fixture();
    const origin = await listen(root);
    const manifest = await fetch(`${origin}/latest.json`).then((response) => response.json());
    const bytes = Buffer.from(
      await fetch(`${origin}/package.app.tar.gz`).then((response) => response.arrayBuffer())
    );
    expect(manifest.platforms["darwin-aarch64"].signature).toBe("new-signature");
    expect(bytes).toEqual(packageBytes);
  });

  it("serves deterministic manifest and package failures", async () => {
    const staleFixture = fixture();
    const staleOrigin = await listen(staleFixture.root, "stale-signature");
    const stale = await fetch(`${staleOrigin}/latest.json`).then((response) => response.json());
    expect(stale.platforms["darwin-aarch64"].signature).toBe("stale-new-signature");

    const truncatedFixture = fixture();
    const truncatedOrigin = await listen(truncatedFixture.root, "truncated-package");
    const truncated = Buffer.from(
      await fetch(`${truncatedOrigin}/package.app.tar.gz`).then((response) =>
        response.arrayBuffer()
      )
    );
    expect(truncated.length).toBeLessThan(truncatedFixture.packageBytes.length);

    const unavailableFixture = fixture();
    const unavailableOrigin = await listen(unavailableFixture.root, "manifest-unavailable");
    expect((await fetch(`${unavailableOrigin}/latest.json`)).status).toBe(503);
  });
});
