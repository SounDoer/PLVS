import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
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

const sheets = styles(root);
const declarations = sheets.flatMap(({ path, source }) => {
  const dom = new JSDOM(`<style>${source}</style>`, { url: "https://website.test/" });
  const result = [];
  function walk(rules) {
    for (const rule of rules) {
      if (rule.style) {
        for (let index = 0; index < rule.style.length; index++) {
          const property = rule.style[index];
          result.push({ path, property, value: rule.style.getPropertyValue(property).trim() });
        }
      }
      if (rule.cssRules) walk(rule.cssRules);
    }
  }
  walk(dom.window.document.styleSheets[0].cssRules);
  dom.window.close();
  return result;
});
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
  const stripped = value.replace(/var\(\s*--[\w-]+\s*\)/g, "").trim();
  const visual =
    /^(?:(?:row-|column-)?gap|(?:margin|padding)(?:-[\w-]+)?|(?:border|outline)(?:-[\w-]+)?|(?:box|text)-shadow|letter-spacing|text-underline-offset|(?:scroll-margin|scroll-padding)(?:-[\w-]+)?)$/;
  if (
    visual.test(property) &&
    /(?:\d*\.)?\d+(?:(?:px|r?em|vh|vw|ch)\b|%)|#[\da-f]+|(?:rgb|hsl|oklch|color)\(/i.test(stripped)
  )
    return true;
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
        (d) => d.path !== tokenPath && roles[d.property] && !roles[d.property].test(d.value)
      )
    ).toEqual([]);
  });

  it("keeps spacing, colors, strokes, shadows and typographic details token-based", () => {
    expect(
      declarations.filter((d) => d.path !== tokenPath && hasLiteralVisualValue(d.property, d.value))
    ).toEqual([]);
  });

  it.each([
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
});
