import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * A `var(--ui-*)` that nothing defines fails silently: the declaration is dropped
 * and the property falls back to its initial value. No console warning, no failing
 * test, just a control that quietly looks wrong. `--ui-radius-modal` sat undefined
 * long enough to square off all three floating panels that asked for it.
 *
 * Walks the tree rather than using `import.meta.glob`, which does not pick up the
 * `.css` files that define most of these tokens.
 */
const SRC = fileURLToPath(new URL("..", import.meta.url));

function sources(dir = SRC, out = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sources(path, out);
    else if (/\.(jsx?|css)$/.test(entry)) out.push([path, readFileSync(path, "utf8")]);
  }
  return out;
}

describe("ui token contract", () => {
  it("defines every --ui-* token the app reads", () => {
    const files = sources();

    const defined = new Set();
    for (const [, source] of files) {
      // `--ui-x: value` in CSS, and the quoted name JS passes to setCssVar.
      for (const m of source.matchAll(/(--ui-[a-z0-9-]+)\s*:/g)) defined.add(m[1]);
      for (const m of source.matchAll(/"(--ui-[a-z0-9-]+)"/g)) defined.add(m[1]);
    }

    const dangling = {};
    for (const [path, source] of files) {
      if (path.includes(".test.")) continue;
      for (const m of source.matchAll(/var\((--ui-[a-z0-9-]+)/g)) {
        if (defined.has(m[1])) continue;
        dangling[m[1]] = [...new Set([...(dangling[m[1]] ?? []), path.slice(SRC.length)])];
      }
    }

    expect(dangling).toEqual({});
  });
});
