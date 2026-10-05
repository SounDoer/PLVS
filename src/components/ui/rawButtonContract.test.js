import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, sep } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Buttons come from a primitive: `Button`, `IconButton`, `IconAction`, `DragHandle` or
 * `AddButton`. Before those were shared, a hundred hand-written `<button>` elements had spread
 * across the app in twenty-eight distinct combinations of height, radius, font size and hover
 * treatment, most of them meant to be the same thing.
 *
 * This is a ratchet, not a clean slate. The counts below are the hand-written buttons that
 * remain: list rows, menu triggers and one-off controls with no primitive yet, plus the primitives
 * that live outside `components/ui`. A new `<button>` anywhere fails this test; use a primitive, or
 * add one if nothing fits. Converting an existing one means lowering its count here in the same
 * change, which is how the list shrinks.
 */
const KNOWN_RAW_BUTTONS = {
  // Primitives that live outside components/ui.
  "components/AddButton.jsx": 1,
  "components/IconButton.jsx": 1,
  // Must render without the theme or any shared component.
  "components/AppCrashBoundary.jsx": 1,
  // The Source Transport is a documented emphasis exception (design-tokens.md).
  "components/SourceTransportCluster.jsx": 3,
  // Not converted yet.
  "components/AppHeader.jsx": 2,
  "components/AppShell.jsx": 2,
  "components/ColorControl.jsx": 1,
  "components/CopyableTextBlock.jsx": 1,
  "components/CrashReportDialog.jsx": 2,
  "components/FeedbackDialog.jsx": 1,
  "components/FileAnalysisHistoryMenu.jsx": 4,
  "components/FileAnalysisSummary.jsx": 2,
  "components/HelpPopover.jsx": 1,
  "components/LibraryExportDialog.jsx": 1,
  "components/LoudnessProfilePopover.jsx": 2,
  "components/PanelSettingsContent.jsx": 3,
  "components/PanelSettingsMenu.jsx": 1,
  "components/PresetsPopover.jsx": 1,
  "components/SettingsPanel.jsx": 5,
  "components/ThemeEditor.jsx": 2,
  "components/ThemePicker.jsx": 2,
  "components/theme-editor/AdvancedPage.jsx": 1,
  "components/theme-editor/ThemePreview.jsx": 1,
  "components/theme-editor/ThemeWarningSummary.jsx": 1,
  "dock/editors/DockModulesEditor.jsx": 1,
  "dock/modules/DockLevel.jsx": 1,
  "workspace/LeafView.jsx": 4,
  "workspace/SplitLayout.jsx": 2,
  "workspace/WorkspaceToolbar.jsx": 1,
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
