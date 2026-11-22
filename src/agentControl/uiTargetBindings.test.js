import { describe, expect, it } from "vitest";
import { normalizePanelControls, panelControlUiRows } from "../lib/panelControls.js";
import { readPublicPanelControls } from "../workspace/panelControlDocument.js";
import {
  PANEL_CONTROL_AXES,
  PANEL_CONTROL_PUBLIC_PATHS,
  uiTargetBinding,
} from "./uiTargetBindings.js";

const MODULES = [
  "levelMeter",
  "loudness",
  "waveform",
  "spectrogram",
  "spectrum",
  "stereo-map",
  "stats",
  "vectorscope",
];

function at(value, path) {
  return path.split(".").reduce((current, key) => current?.[key], value);
}

describe("UI target bindings", () => {
  it("binds every Panel Settings row to a public control or axis", () => {
    const unbound = MODULES.flatMap((moduleId) =>
      panelControlUiRows(moduleId)
        .map((row) => row.key ?? row.minKey)
        .filter((key) => !uiTargetBinding(`panel-control:p1:${key}`))
        .map((key) => `${moduleId}:${key}`)
    );
    expect(unbound).toEqual([]);
  });

  it("names a field the module's public document carries with the row's value", () => {
    const controls = normalizePanelControls(undefined);
    for (const moduleId of MODULES) {
      const document = readPublicPanelControls(moduleId, controls);
      for (const row of panelControlUiRows(moduleId)) {
        const key = row.key ?? row.minKey;
        const path = PANEL_CONTROL_PUBLIC_PATHS[key];
        if (!path) {
          expect(PANEL_CONTROL_AXES[key], `${moduleId}:${key}`).toBeTruthy();
          continue;
        }
        const value = at(document, path);
        expect(value, `${moduleId}:${key} → ${path}`).not.toBeUndefined();
        // Ranges, bands and thresholds start at the row's key; lists and metrics are reshaped.
        if (row.ui.widget === "thresholds") expect(value.warning).toBe(controls[key]);
        else if (row.minKey) {
          expect(value.min ?? value.lowMid, `${moduleId}:${key}`).toBe(controls[key]);
        } else if (typeof controls[key] !== "object") {
          expect(value, `${moduleId}:${key} → ${path}`).toEqual(controls[key]);
        }
      }
    }
  });

  it("binds Settings rows to their settings update field", () => {
    expect(uiTargetBinding("setting:appearance.interfaceSize")).toEqual({
      command: "settings update",
      path: "interfaceSize",
    });
    expect(uiTargetBinding("setting:updates.autoDownload")).toEqual({
      command: "settings update",
      path: "updates.autoDownload",
    });
    expect(uiTargetBinding("setting:shortcuts.startStop")).toEqual({
      command: "settings update",
      path: "keyboardShortcuts.startStop",
    });
    expect(uiTargetBinding("setting:appearance.theme")).toBeNull();
    expect(uiTargetBinding("toolbar:transport")).toBeNull();
  });

  it("binds axis-backed range rows to the axis command", () => {
    expect(uiTargetBinding("panel-control:spectrum:spectrumXMinFreq")).toEqual({
      command: "axis panel update",
      panelId: "spectrum",
      axis: "frequency",
    });
    expect(uiTargetBinding("panel-control:spectrum:spectrumGrid")).toEqual({
      command: "panel update",
      panelId: "spectrum",
      path: "grid",
    });
  });
});
