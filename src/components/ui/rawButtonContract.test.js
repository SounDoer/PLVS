import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, sep } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Buttons come from a primitive: `Button`, `IconButton`, `IconAction`, `LinkButton`, `MenuRow`,
 * `RowAction`, `TabButton`, `DragHandle` or `AddButton`. Before those were shared, a hundred
 * hand-written `<button>` elements had spread across the app in twenty-eight distinct combinations
 * of height, radius, font size and hover treatment, most of them meant to be the same thing.
 *
 * The counts below are every hand-written button that remains, each with its reason. A new
 * `<button>` anywhere fails this test: use a primitive, or add one when a second control of the
 * same kind appears.
 */
const KNOWN_RAW_BUTTONS = {
  // Primitives that live outside components/ui.
  "components/AddButton.jsx": 1,
  "components/IconButton.jsx": 1,
  // Must render without the theme or any shared component.
  "components/AppCrashBoundary.jsx": 1,
  // The Source Transport is a documented emphasis exception (design-tokens.md).
  "components/SourceTransportCluster.jsx": 3,
  // One-off controls, each the only one of its kind.
  "components/ColorControl.jsx": 1, // swatch that opens the colour picker
  "components/FileAnalysisHistoryMenu.jsx": 1, // caption-sized "Clear all"
  "components/panel-settings/SettingsWidgets.jsx": 1, // disclosure value field
  "components/ThemeEditor.jsx": 1, // Dark / Light segmented choice
  "components/ThemePicker.jsx": 1, // picker trigger styled as a Settings select
  "dock/modules/DockLevel.jsx": 1, // readout that resets the true-peak maximum
};

const SRC = fileURLToPath(new URL("../..", import.meta.url));
const PRIMITIVES_DIR = join("components", "ui") + sep;

function rawButtonCounts(dir = SRC, out = {}) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      rawButtonCounts(path, out);
      continue;
    }
    if (!entry.endsWith(".jsx") || entry.includes(".test.")) continue;
    const relative = path.slice(SRC.length);
    if (relative.startsWith(PRIMITIVES_DIR)) continue;
    const count = readFileSync(path, "utf8").match(/<button\b/g)?.length ?? 0;
    if (count > 0) out[relative.split(sep).join("/")] = count;
  }
  return out;
}

describe("raw button contract", () => {
  it("adds no hand-written button outside the primitives", () => {
    expect(rawButtonCounts()).toEqual(KNOWN_RAW_BUTTONS);
  });
});
