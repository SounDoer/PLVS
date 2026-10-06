import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, sep } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Padding, margin and gap utilities stay on the 4px grid -- see Spacing Tokens in
 * design-tokens.md. Tailwind's half steps (`px-1.5` is 6px, `gap-0.5` is 2px) and one-pixel gaps
 * had accumulated to about a hundred and fifty uses in two dozen spellings.
 *
 * The Dock strip is exempt: its spacing is the responsive set in `dock/dockTokens.css`, which
 * steps with the strip's height rather than with this grid. The Dock editors are not exempt; they
 * are ordinary settings surfaces.
 */
const SRC = fileURLToPath(new URL("../..", import.meta.url));
const PROPERTY = "(?:p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap|gap-x|gap-y|space-x|space-y)";
const OFF_GRID = new RegExp(
  `(?<![\\w\\[\\]-])(?:[a-z-]+:)*-?${PROPERTY}-(?:\\d+\\.5|px|\\[-?[\\d.]+px\\])(?![\\w.-])`,
  "g"
);
const CLASS_STRING = /"[^"\n]*"|'[^'\n]*'|`[^`]*`/g;

function offenders(dir = SRC, out = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      offenders(path, out);
      continue;
    }
    if (!/\.jsx?$/.test(entry) || entry.includes(".test.")) continue;
    const relative = path.slice(SRC.length).split(sep).join("/");
    if (relative.startsWith("dock/") && !relative.startsWith("dock/editors/")) continue;
    for (const literal of readFileSync(path, "utf8").match(CLASS_STRING) ?? []) {
      for (const token of literal.match(OFF_GRID) ?? []) out.push(`${relative}: ${token}`);
    }
  }
  return out;
}

describe("spacing class contract", () => {
  it("uses no padding, margin or gap between the 4px steps", () => {
    expect(offenders()).toEqual([]);
  });
});
