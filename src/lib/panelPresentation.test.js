import { describe, expect, it } from "vitest";
import { normalizePanelPresentation } from "./panelPresentation.js";
import { planViewUpdate, planViewReset } from "../agentControl/viewControl.js";

describe("panel presentation", () => {
  it.each([true, false])("preserves an explicit Dock annotation preference: %s", (value) => {
    expect(
      normalizePanelPresentation({ dock: { hideAxesAndLabels: value } }).dock.hideAxesAndLabels
    ).toBe(value);
  });

  it("migrates the old header preference without inventing Dock headers", () => {
    expect(normalizePanelPresentation(null, { compactPanels: true })).toEqual({
      workspace: { hidePanelHeaders: true, hideAxesAndLabels: false },
      dock: { hideAxesAndLabels: false },
    });
    expect(
      normalizePanelPresentation(
        { workspace: { hidePanelHeaders: false }, dock: { hideAxesAndLabels: false } },
        { compactPanels: true }
      )
    ).toEqual({
      workspace: { hidePanelHeaders: false, hideAxesAndLabels: false },
      dock: { hideAxesAndLabels: false },
    });
  });

  it("updates only the addressed surface and synchronizes the compatibility alias", () => {
    const first = planViewUpdate(
      {},
      { panelPresentation: { workspace: { hidePanelHeaders: true } } }
    );
    const second = planViewUpdate(first.view, {
      panelPresentation: { dock: { hideAxesAndLabels: true } },
    });
    expect(second.issues).toEqual([]);
    expect(second.view.panelPresentation).toEqual({
      workspace: { hidePanelHeaders: true, hideAxesAndLabels: false },
      dock: { hideAxesAndLabels: true },
    });
    expect(second.view.focusView.compactPanels).toBe(true);
    expect(second.changed).toEqual(["view.panelPresentation.dock.hideAxesAndLabels"]);
    expect(planViewReset(second.view).view.panelPresentation).toEqual(
      normalizePanelPresentation(null)
    );
  });

  it.each([
    { panelPresentation: { dock: { hidePanelHeaders: true } } },
    { panelPresentation: { dock: { hideAxesAndLabels: 1 } } },
    {
      panelPresentation: { workspace: { hidePanelHeaders: false } },
      focusView: { compactPanels: true },
    },
  ])("rejects unsupported or conflicting controls before mutation", (patch) => {
    const result = planViewUpdate({}, { pinned: true, ...patch });
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.changed).toEqual([]);
    expect(result.view.pinned).toBe(false);
  });
});
