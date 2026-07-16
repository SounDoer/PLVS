import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const indexCss = readFileSync(join(srcDir, "index.css"), "utf8");

describe("settings drawer responsive contract", () => {
  it("clamps the preferred width while preserving a dismissible backdrop gutter", () => {
    expect(indexCss).toContain("width: min(var(--ui-drawer-w), calc(100dvw - 2rem));");
  });

  it("uses a full-width fallback only for extremely narrow windows", () => {
    expect(indexCss).toContain("@media (max-width: 359px)");
    expect(indexCss).toContain("width: 100dvw;");
  });

  it("stacks only explicitly adaptive rows when drawer content becomes too narrow", () => {
    expect(indexCss).toContain("@container (max-width: 347px)");
    expect(indexCss).toContain(".settings-row-stackable");
  });
});
