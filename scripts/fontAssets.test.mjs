import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repositoryRoot = join(fileURLToPath(new URL("..", import.meta.url)));

const FONT_ASSETS = [
  {
    file: "InterVariable-4.1.woff2",
    sha256: "693b77d4f32ee9b8bfc995589b5fad5e99adf2832738661f5402f9978429a8e3",
  },
  {
    file: "JetBrainsMono-Regular-2.304.woff2",
    sha256: "a9cb1cd82332b23a47e3a1239d25d13c86d16c4220695e34b243effa999f45f2",
  },
  {
    file: "JetBrainsMono-SemiBold-2.304.woff2",
    sha256: "918edad542a1da608fd2ba8daebaff9ac802309103fe760eed465b8b4e47faf1",
  },
];

describe("bundled font assets", () => {
  it("keeps the reviewed upstream binaries and CSS declarations together", async () => {
    const css = await readFile(join(repositoryRoot, "src", "index.css"), "utf8");

    for (const asset of FONT_ASSETS) {
      const contents = await readFile(join(repositoryRoot, "src", "assets", "fonts", asset.file));
      expect(createHash("sha256").update(contents).digest("hex")).toBe(asset.sha256);
      expect(css).toContain(asset.file);
    }

    expect(css).toContain('font-family: "Inter"');
    expect(css).toContain('font-family: "JetBrains Mono"');
    expect(css).toContain("font-weight: 400 700");
  });
});
