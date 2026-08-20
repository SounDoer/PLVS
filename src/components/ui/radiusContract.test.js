import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Three rungs off `--radius` plus the pill — see design-tokens.md. The ladder is
 * unenforceable by eye: `rounded` and `rounded-sm` are two pixels apart, so a
 * wrong rung never looks wrong enough for anyone to notice, and the app had
 * drifted to eight distinct radii before this was written down.
 */
const ALLOWED = new Set(["rounded-xs", "rounded-md", "rounded-xl", "rounded-full"]);
const SRC = fileURLToPath(new URL("../..", import.meta.url));

/** Any `rounded*` utility, including the side-scoped and arbitrary-value forms. */
const RADIUS = /\brounded(?:-(?:t|b|l|r|tl|tr|bl|br))?(?:-[a-z0-9[\]()\-_.%]+)?\b/g;
const CLASS_STRING = /"[^"\n]*"|'[^'\n]*'|`[^`]*`/g;
const LOOKS_LIKE_CLASSES =
  /(?:flex|px-|py-|p-|text-|border|items-|gap-|size-|h-|w-|absolute|relative|inline)/;

function classStrings(dir = SRC, out = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      classStrings(path, out);
      continue;
    }
    if (!/\.jsx?$/.test(entry) || entry.includes(".test.")) continue;
    const source = readFileSync(path, "utf8");
    for (const literal of source.match(CLASS_STRING) ?? []) {
      // Skip prose, which uses the word "rounded" for rounding numbers.
      if (LOOKS_LIKE_CLASSES.test(literal)) out.push([path.slice(SRC.length), literal]);
    }
  }
  return out;
}

describe("radius contract", () => {
  it("spends only the rungs the ladder defines", () => {
    const offenders = {};

    for (const [path, literal] of classStrings()) {
      for (const match of literal.matchAll(RADIUS)) {
        // A side-scoped rung carries its side: rounded-t-md is the md rung.
        const rung = match[0].replace(/^rounded-(?:t|b|l|r|tl|tr|bl|br)-/, "rounded-");
        if (ALLOWED.has(rung)) continue;
        offenders[match[0]] = [...new Set([...(offenders[match[0]] ?? []), path])];
      }
    }

    // `rounded` compiles to a literal that ignores --radius; `rounded-[8px]`
    // copies today's value of a token into the source. Both opt out of the
    // ladder without looking like they do.
    expect(offenders).toEqual({});
  });
});
