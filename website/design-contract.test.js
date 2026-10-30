import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { generate, lexer, parse, walk } from "css-tree";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("./", import.meta.url));
function styles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return styles(path);
    if (!/\.(css|html)$/.test(path)) return [];
    const source = readFileSync(path, "utf8");
    const name = relative(root, path).replaceAll("\\", "/");
    if (path.endsWith(".css")) return [{ path: name, source }];
    const dom = new JSDOM(source);
    const embedded = [...dom.window.document.querySelectorAll("style")].map((node) => ({
      path: name,
      source: node.textContent,
    }));
    const inline = [...dom.window.document.querySelectorAll("[style]")].map((node) => ({
      path: name,
      source: `.inline { ${node.getAttribute("style")} }`,
    }));
    dom.window.close();
    return [...embedded, ...inline];
  });
}

function declarationsFromSource({ path, source }) {
  const result = [];
  // This contract checks authored values. CSSOM expands shorthands and supplies defaults,
  // so `border: none` can otherwise look like an authored `medium` border width.
  const ast = parse(source, {
    onParseError(error) {
      throw new Error(`${path}: ${error.message}`, { cause: error });
    },
  });
  walk(ast, {
    visit: "Declaration",
    enter(node) {
      result.push({
        path,
        property: node.property,
        value: generate(node.value).trim(),
      });
    },
  });
  return result;
}

const declarations = styles(root).flatMap(declarationsFromSource);
const tokenPath = "assets/site-tokens.css";
const shared = new Set(
  declarations
    .filter((d) => d.path === tokenPath && d.property.startsWith("--"))
    .map((d) => d.property)
);

// Layout geometry (widths, breakpoints, aspect ratios, positioning) is deliberately outside
// this contract. Decorative and spacing values must come from the shared design vocabulary.
function hasLiteralVisualValue(property, value) {
  // Radius roles and the circular-control exception are checked separately below.
  if (property === "border-radius") return false;
  const stripped = normalizeZeroDimensions(value)
    .replace(/var\(\s*--[\w-]+\s*\)/g, "")
    .trim();
  const visual =
    /^(?:(?:row-|column-)?gap|(?:margin|padding)(?:-[\w-]+)?|(?:border|outline)(?:-[\w-]+)?|(?:box|text)-shadow|letter-spacing|text-underline-offset|(?:scroll-margin|scroll-padding)(?:-[\w-]+)?)$/;
  if (
    visual.test(property) &&
    /(?:\d*\.)?\d+(?:(?:px|r?em|vh|vw|ch)\b|%)|#[\da-f]+|(?:rgb|hsl|oklch|color)\(/i.test(stripped)
  )
    return true;
  if (/^(?:box|text)-shadow$/.test(property)) {
    let literalColor = false;
    walk(parse(stripped, { context: "value" }), (node) => {
      if (
        node.type === "Identifier" &&
        !/^(?:transparent|currentColor)$/i.test(node.name) &&
        lexer.matchType("color", node.name).matched
      )
        literalColor = true;
    });
    if (literalColor) return true;
  }
  if (
    /^(?:color|background(?:-color)?|(?:border(?:-[\w]+)?|outline)-color|fill|stroke)$/.test(
      property
    )
  ) {
    return !/^(?:\s*(?:transparent|currentColor|inherit|initial|unset|none))*\s*$/i.test(stripped);
  }
  if (/^(?:border(?:-(?:top|right|bottom|left))?|outline)$/.test(property)) {
    return !/^(?:\s*(?:0|solid|dashed|dotted|none|transparent|currentColor|inherit))*\s*$/i.test(
      stripped
    );
  }
  if (property === "font-weight") return !/^(?:|inherit|normal)$/.test(stripped);
  if (property === "font") return !/^(?:\/?|inherit)$/.test(stripped);
  if (property === "line-height") return !/^(?:|1|inherit|normal)$/.test(stripped);
  if (property === "opacity") return !/^(?:|0|1|inherit)$/.test(stripped);
  if (/^(?:transition|animation)(?:-[\w-]+)?$/.test(property)) {
    return /\d(?:ms|s)\b/.test(stripped.replaceAll("0.01ms", ""));
  }
  return false;
}

function normalizeZeroDimensions(value) {
  return value.replace(
    /(?<![\w.-])[+-]?(?:\d*\.)?\d+(?:e[+-]?\d+)?(?:(?:px|r?em|vh|vw|ch)\b|%)/gi,
    (dimension) => (parseFloat(dimension) === 0 ? "0" : dimension)
  );
}

describe("public website design contract", () => {
  it("keeps shared token definitions in the shared stylesheet", () => {
    expect(shared.size).toBeGreaterThan(0);
    expect(declarations.filter((d) => d.path !== tokenPath && shared.has(d.property))).toEqual([]);
  });

  it("rejects unknown token references even when a fallback hides them", () => {
    const missing = declarations.flatMap((d) => {
      const local = new Set(
        declarations
          .filter((other) => other.path === d.path && other.property.startsWith("--"))
          .map((other) => other.property)
      );
      return [...d.value.matchAll(/var\(\s*(--[\w-]+)/g)]
        .filter((match) => !shared.has(match[1]) && !local.has(match[1]))
        .map((match) => ({ ...d, missing: match[1] }));
    });
    expect(missing).toEqual([]);
  });

  it("uses shared typography and radius roles instead of page-specific values", () => {
    const roles = {
      "font-size": /^var\(--text-[\w-]+\)$|^inherit$/,
      "font-family": /^var\(--font-[\w-]+\)$|^inherit$/,
      "border-radius": /^var\(--radius-(?:control|panel|preview)\)$|^0$|^50%$/,
    };
    expect(
      declarations.filter(
        (d) =>
          d.path !== tokenPath &&
          roles[d.property] &&
          !roles[d.property].test(normalizeZeroDimensions(d.value))
      )
    ).toEqual([]);
  });

  it("keeps spacing, colors, strokes, shadows and typographic details token-based", () => {
    expect(
      declarations.filter((d) => d.path !== tokenPath && hasLiteralVisualValue(d.property, d.value))
    ).toEqual([]);
  });

  it.each([
    ["gap", "1px"],
    ["padding", "0px 1px"],
    ["border", "0px solid red"],
    ["box-shadow", "0px 0px 0px black"],
    ["letter-spacing", "0.001em"],
    ["gap", "13px"],
    ["gap", "5%"],
    ["font", "18px/1.6 Arial"],
    ["padding", "2px var(--space-1)"],
    ["color", "red"],
    ["background", "#fff"],
    ["border", "1px solid var(--color-divider)"],
    ["outline-offset", "3px"],
    ["box-shadow", "0 2px 8px black"],
    ["letter-spacing", "0.01em"],
    ["font-weight", "600"],
    ["line-height", "1.6"],
    ["text-underline-offset", "4px"],
    ["opacity", "0.45"],
    ["transition", "color 150ms ease"],
  ])("detects accidental literals in %s: %s", (property, value) => {
    expect(hasLiteralVisualValue(property, value)).toBe(true);
  });

  it.each([
    ["margin", "0px auto"],
    ["padding", "0px 0rem"],
    ["border", "0px solid var(--color-divider)"],
    ["border", "none"],
    ["letter-spacing", "0em"],
  ])("allows zero resets in %s: %s", (property, value) => {
    expect(hasLiteralVisualValue(property, value)).toBe(false);
  });

  it("reads authored declarations inside nested rules without adding shorthand defaults", () => {
    const source = `@media (min-width: 1px) {
      .reset { border: none; margin: 0px /* not a 13px literal */ auto; border-radius: 0; }
      @supports (display: grid) { .bad { padding: 0px 1px !important; } }
    }`;
    const parsed = declarationsFromSource({ path: "fixture.css", source });
    expect(parsed).toEqual([
      { path: "fixture.css", property: "border", value: "none" },
      { path: "fixture.css", property: "margin", value: "0px auto" },
      { path: "fixture.css", property: "border-radius", value: "0" },
      { path: "fixture.css", property: "padding", value: "0px 1px" },
    ]);
    expect(parsed.filter((d) => hasLiteralVisualValue(d.property, d.value))).toEqual([
      { path: "fixture.css", property: "padding", value: "0px 1px" },
    ]);
  });
});
