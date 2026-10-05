import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, sep } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * State feedback never animates: a hover, press, selection or validity change switches colour,
 * fill, border, opacity and shadow at once. Motion is kept for spatial change and data smoothing
 * only, at the framework's default duration -- see design-tokens.md.
 *
 * Before this rule the app carried about forty colour transitions at four different durations,
 * none of which a "reduce motion" system preference could switch off.
 */
const SRC = fileURLToPath(new URL("../..", import.meta.url));

const STATE_FEEDBACK_TRANSITION =
  /(?<![\w-])transition-(?:colors|all|shadow|\[[^\]\s]*(?:color|shadow|opacity)[^\]\s]*\])(?![\w-])/g;
const DURATION = /(?<![\w-])duration-(?:\[[^\]]+\]|\d+)(?![\w-])/g;
const OPACITY_TRANSITION = /(?<![\w-])transition-opacity(?![\w-])/g;

/** The correlation marker glides along its rail as the measured value changes: data smoothing. */
const DATA_SMOOTHING = "transition-[left,background-color] duration-100 ease-out";
const DATA_SMOOTHING_FILES = new Set([
  "components/panels/VectorscopePanel.jsx",
  "dock/modules/DockVectorscope.jsx",
]);
/** The tooltip's delayed fade is an enter animation. */
const OPACITY_TRANSITION_FILES = new Set(["components/HoverTip.jsx"]);

function offenders(dir = SRC, out = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      offenders(path, out);
      continue;
    }
    if (!/\.jsx?$/.test(entry) || entry.includes(".test.")) continue;
    const relative = path.slice(SRC.length).split(sep).join("/");
    let source = readFileSync(path, "utf8");
    if (DATA_SMOOTHING_FILES.has(relative)) source = source.split(DATA_SMOOTHING).join("");
    const found = [
      ...(source.match(STATE_FEEDBACK_TRANSITION) ?? []),
      ...(source.match(DURATION) ?? []),
      ...(OPACITY_TRANSITION_FILES.has(relative) ? [] : (source.match(OPACITY_TRANSITION) ?? [])),
    ];
    for (const token of found) out.push(`${relative}: ${token}`);
  }
  return out;
}

describe("motion contract", () => {
  it("animates no state feedback and sets no ad hoc duration", () => {
    expect(offenders()).toEqual([]);
  });

  it("switches CSS motion off for a reduce-motion preference", () => {
    const css = readFileSync(new URL("../../index.css", import.meta.url), "utf8");
    const rule = css.match(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}/)?.[0] ?? "";

    expect(rule).toMatch(/\*,\s*\*::before,\s*\*::after/);
    expect(rule).toContain("transition-duration: 0.01ms !important");
    expect(rule).toContain("animation-duration: 0.01ms !important");
  });
});
