/** @vitest-environment jsdom */
import { describe, expect, it, beforeEach } from "vitest";
import { DEFAULT_WORKSPACE_STATE } from "./constants";
import { normalizeAxisViewportsState } from "./axisViewports";
import { DEFAULT_PANEL_CONTROLS, normalizePanelControls } from "../lib/panelControls";
import { workspaceStore } from "../persistence/index.js";

describe("the shared viewport in workspace state", () => {
  it("starts at the full range", () => {
    expect(DEFAULT_WORKSPACE_STATE.axisViewports).toEqual({
      frequency: { min: 20, max: 20000 },
      time: { windowSec: 60, offsetSec: 0 },
    });
  });

  it("supplies every kind when a payload predates the feature", () => {
    expect(normalizeAxisViewportsState(undefined)).toEqual({
      frequency: { min: 20, max: 20000 },
      time: { windowSec: 60, offsetSec: 0 },
    });
  });

  it("repairs a stored value rather than trusting it", () => {
    // Inverted and out of bounds. What it repairs *to* is the local control's business -- asserted
    // in axisViewports.test.js -- so this only demands the result be usable.
    const { frequency } = normalizeAxisViewportsState({ frequency: { min: 90000, max: 1 } });

    expect(frequency.min).toBeGreaterThanOrEqual(20);
    expect(frequency.max).toBeLessThanOrEqual(20000);
    expect(Math.log2(frequency.max / frequency.min)).toBeGreaterThanOrEqual(1);
  });

  it("keeps a valid stored value", () => {
    expect(normalizeAxisViewportsState({ frequency: { min: 200, max: 5000 } })).toEqual({
      frequency: { min: 200, max: 5000 },
      time: { windowSec: 60, offsetSec: 0 },
    });
  });

  it("drops a kind that no longer exists", () => {
    const normalized = normalizeAxisViewportsState({
      frequency: { min: 200, max: 5000 },
      loudnessOfTheAncients: { min: 0, max: 1 },
    });

    expect(Object.keys(normalized)).toEqual(["frequency", "time"]);
  });
});

describe("membership on panel controls", () => {
  it("defaults to linked", () => {
    expect(normalizePanelControls(DEFAULT_PANEL_CONTROLS).linkFrequencyViewport).toBe(true);
    expect(normalizePanelControls(DEFAULT_PANEL_CONTROLS).linkTimeViewport).toBe(true);
    expect(normalizePanelControls(DEFAULT_PANEL_CONTROLS).historyWindowSec).toBe(60);
    expect(normalizePanelControls(DEFAULT_PANEL_CONTROLS).historyOffsetSec).toBe(0);
  });

  it("links a panel whose stored controls predate the feature", () => {
    // The owner accepted the upgrade-time change: existing panels join the group.
    const legacy = { ...DEFAULT_PANEL_CONTROLS };
    delete legacy.linkFrequencyViewport;

    expect(normalizePanelControls(legacy).linkFrequencyViewport).toBe(true);
  });

  it("honours an explicit opt-out", () => {
    expect(
      normalizePanelControls({ ...DEFAULT_PANEL_CONTROLS, linkFrequencyViewport: false })
        .linkFrequencyViewport
    ).toBe(false);
  });

  it("repairs a non-boolean", () => {
    expect(
      normalizePanelControls({ ...DEFAULT_PANEL_CONTROLS, linkFrequencyViewport: "yes" })
        .linkFrequencyViewport
    ).toBe(true);
  });
});

describe("persistence", () => {
  beforeEach(() => {
    workspaceStore.reset();
  });

  it("round-trips the shared viewport through the workspace domain", () => {
    workspaceStore.patch({ axisViewports: { frequency: { min: 200, max: 5000 } } });

    expect(workspaceStore.read().axisViewports).toEqual({ frequency: { min: 200, max: 5000 } });
  });
});
