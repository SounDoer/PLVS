/** @vitest-environment jsdom */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { applyDocumentSurface } from "./documentSurface.js";

const currentDir = dirname(fileURLToPath(import.meta.url));
const indexCss = readFileSync(join(currentDir, "../../index.css"), "utf8");

describe("applyDocumentSurface", () => {
  afterEach(() => {
    delete document.documentElement.dataset.surface;
  });

  it("marks the Dock editor document from its accessory query", () => {
    expect(applyDocumentSurface("?surface=dock-editor", document)).toBe("dock-editor");
    expect(document.documentElement.dataset.surface).toBe("dock-editor");
  });

  it("does not mark the normal application document", () => {
    document.documentElement.dataset.surface = "dock-editor";

    expect(applyDocumentSurface("", document)).toBeNull();
    expect(document.documentElement.dataset.surface).toBeUndefined();
  });

  it("keeps the editor viewport transparent without changing normal body styling", () => {
    expect(indexCss).toContain('html[data-surface="dock-editor"] body');
    expect(indexCss).toContain('html[data-surface="dock-editor"] #root');
    expect(indexCss).toMatch(
      /html\[data-surface="dock-editor"\][^{]*\{\s*background: transparent;/s
    );
  });
});
