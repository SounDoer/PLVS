import { describe, expect, it } from "vitest";
import {
  DEFAULT_VIEW,
  buildViewDescription,
  buildViewInspection,
  planViewReset,
  planViewUpdate,
} from "./viewControl.js";

const current = {
  pinned: false,
  focusView: { autoHideControls: false, compactPanels: false, borderless: false },
  panelOpacity: 100,
  glassEnabled: false,
};

describe("View Control", () => {
  it("describes public values, schema, runtime ownership, and availability", () => {
    expect(buildViewDescription(current, { platform: "windows", docked: true })).toMatchObject({
      view: current,
      runtime: { windowPresentation: { state: "suspended", owner: "dock" } },
      availability: {
        pinned: { writable: true, active: false, reason: "dockOwnsWindowPresentation" },
        glassEnabled: { writable: false, active: false, reason: "platformUnsupported" },
      },
      schema: {
        panelOpacity: { type: "integer", minimum: 0, maximum: 100, current: 100 },
      },
    });
    expect(buildViewInspection(current, { platform: "macos" }).view).toEqual(current);
  });

  it("strictly validates and merge-patches Focus View atomically", () => {
    const planned = planViewUpdate(
      current,
      { pinned: true, focusView: { compactPanels: true }, panelOpacity: 85 },
      { platform: "windows" }
    );
    expect(planned).toMatchObject({
      view: {
        pinned: true,
        focusView: { autoHideControls: false, compactPanels: true, borderless: false },
        panelOpacity: 85,
      },
      changed: ["view.pinned", "view.focusView.compactPanels", "view.panelOpacity"],
      effects: ["alwaysOnTop", "compactPanels", "panelOpacity"],
      issues: [],
    });
    expect(
      planViewUpdate(
        current,
        { focusView: { compactPanels: "yes" }, panelOpacity: 84.5 },
        { platform: "windows" }
      )
    ).toMatchObject({
      view: current,
      changed: [],
      issues: [
        { code: "invalidType", path: "$.focusView.compactPanels" },
        { code: "invalidRange", path: "$.panelOpacity" },
      ],
    });
  });

  it("refuses explicit Glass writes off macOS but lets reset clear portable stale state", () => {
    expect(
      planViewUpdate(current, { glassEnabled: false }, { platform: "windows" }).refusal
    ).toEqual({ code: "controlUnavailable", reason: "platformUnsupported", field: "glassEnabled" });
    expect(
      planViewReset({ ...current, pinned: true, glassEnabled: true }, { platform: "windows" })
    ).toMatchObject({
      view: DEFAULT_VIEW,
      changed: ["view.pinned", "view.glassEnabled"],
      refusal: null,
    });
  });

  it("warns for changed window presentation fields while Dock owns the form", () => {
    const planned = planViewUpdate(
      current,
      { pinned: true, focusView: { borderless: true }, panelOpacity: 75 },
      { platform: "windows", docked: true }
    );
    expect(planned.warnings).toEqual([
      {
        code: "currentlyInactive",
        path: "view.pinned",
        reason: "dockOwnsWindowPresentation",
      },
      {
        code: "currentlyInactive",
        path: "view.focusView.borderless",
        reason: "dockOwnsWindowPresentation",
      },
    ]);
  });
});
