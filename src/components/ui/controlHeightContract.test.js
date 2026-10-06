import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, sep } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Form controls take one height, `--ui-control-h`: 24px at the Default Interface Size, growing with
 * the larger sizes -- see design-tokens.md. Buttons had been 36px, inputs 24px, 28px or 35px, and
 * selects 24px or 28px, depending on which file they were written in.
 *
 * Shell chrome is one step taller, `--ui-shell-h`, derived from the same token. A fixed height
 * above 24px is allowed only for the Theme Preview's sample swatches, which are pictures of
 * controls rather than controls.
 */
const SRC = fileURLToPath(new URL("../..", import.meta.url));
const TALL = /(?<![\w-])(?:h|size)-(?:7|8|9|10|11|12)(?![\w-.])/g;

const ALLOWED = {
  "components/theme-editor/ThemePreview.jsx": ["h-9", "h-12"], // sample swatches and meters
};

function offenders(dir = SRC, out = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      offenders(path, out);
      continue;
    }
    if (!/\.jsx?$/.test(entry) || entry.includes(".test.")) continue;
    const relative = path.slice(SRC.length).split(sep).join("/");
    const allowed = new Set(ALLOWED[relative] ?? []);
    for (const token of readFileSync(path, "utf8").match(TALL) ?? []) {
      if (!allowed.has(token)) out.push(`${relative}: ${token}`);
    }
  }
  return out;
}

describe("control height contract", () => {
  it("sizes the shared controls from the control height token", () => {
    for (const file of ["./button.jsx", "./select.jsx"]) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(source).toContain("h-[var(--ui-control-h)]");
      expect(source).not.toMatch(/(?<![\w-])h-6(?![\w-])/);
    }
  });

  it("sizes list rows and dropdown options from the same ladder", () => {
    const read = (file) => readFileSync(new URL(file, import.meta.url), "utf8");

    expect(read("./row.jsx")).toContain("min-h-[var(--ui-row-h)]");
    expect(read("../ManagementRow.jsx")).toContain("min-h-[var(--ui-row-h)]");
    expect(read("./select.jsx")).toContain("min-h-[var(--ui-shell-h)]");

    const css = read("../../index.css");
    expect(css).toContain("--ui-shell-h: calc(var(--ui-control-h) + 4px);");
    expect(css).toContain("--ui-row-h: calc(var(--ui-control-h) + 8px);");
  });

  it("sets no fixed height above 24px", () => {
    expect(offenders()).toEqual([]);
  });
});
