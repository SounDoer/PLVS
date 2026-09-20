import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(currentDir, "index.html"), "utf8");
const deployment = readFileSync(
  join(currentDir, "..", "..", ".github", "workflows", "deploy-landing.yml"),
  "utf8"
);

describe("Privacy Policy", () => {
  it("ships at /privacy/ with the recursively deployed landing site", () => {
    expect(deployment).toContain("cp -r landing _site");
    expect(deployment).toContain("path: _site/");
    expect(html).toContain("<title>PLVS Privacy Policy</title>");
  });

  it("protects the core privacy promises from accidental removal", () => {
    expect(html).toContain("never uploads audio samples, audio files, or measurement data");
    expect(html).toContain("checks for updates when the app starts and every 12 hours");
    expect(html).toContain("Subscriber records remain until you request deletion");
    expect(html).toContain("Diagnostics are off by default");
    expect(html).toContain("Nothing is sent until you select <strong>Send</strong>");
    expect(html).toContain("keeps at most the newest five local crash reports");
    expect(html).toContain("xichen@soundoer.com");
  });

  it("resolves every local page and asset link", () => {
    const targets = [...html.matchAll(/(?:href|src)="([^"#]+)"/g)]
      .map(([, target]) => target)
      .filter((target) => !/^[a-z]+:/.test(target));
    const missing = targets.filter((target) => {
      const path = join(currentDir, target);
      return !existsSync(path) && !existsSync(join(path, "index.html"));
    });

    expect(missing).toEqual([]);
  });
});
