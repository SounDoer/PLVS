/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { settingsStore, workspaceStore } from "../persistence/index.js";
import { BUILTIN_THEMES_V2 } from "../theme/builtinThemesV2.js";
import { buildCommunityThemePreviewPlan } from "../theme/communityThemePreview.js";
import { themeToPortable } from "../theme/portableTheme.js";
import { buildCommunityPreviewPlan } from "../transfer/communityPreview.js";
import { buildPack } from "../transfer/packShape.js";
import { DEFAULT_WORKSPACE_STATE } from "../workspace/constants.js";
import { CommunityPreviewApp } from "./CommunityPreviewApp.jsx";

const PROFILE = {
  id: "broadcast",
  name: "I −23 ±0.5 · TP ≤ −1",
  referenceLufs: -23,
  rules: [
    { metricId: "integrated", op: ">", value: -22.5, severity: "fail" },
    { metricId: "integrated", op: "<", value: -23.5, severity: "fail" },
    { metricId: "truePeak", op: ">", value: -1, severity: "fail" },
  ],
};

beforeAll(() => {
  class ResizeObserverStub {
    observe() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = ResizeObserverStub;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Community preview browser harness", () => {
  it("renders the production Profile editor without reading or writing persisted state", async () => {
    const settingsRead = vi.spyOn(settingsStore, "read");
    const settingsPatch = vi.spyOn(settingsStore, "patch");
    const workspaceRead = vi.spyOn(workspaceStore, "read");
    const workspacePatch = vi.spyOn(workspaceStore, "patchCoalesced");
    const plan = await buildCommunityPreviewPlan(buildPack("loudness", [PROFILE]), "loudness");

    render(<CommunityPreviewApp plan={plan} asset={plan.assets[0]} />);

    expect(screen.getByRole("dialog", { name: "Loudness Profile editor" })).toBeTruthy();
    expect(screen.getByText(PROFILE.name)).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Rule 3 metric" }).textContent).toContain(
      "True Peak Max"
    );
    expect(settingsRead).not.toHaveBeenCalled();
    expect(settingsPatch).not.toHaveBeenCalled();
    expect(workspaceRead).not.toHaveBeenCalled();
    expect(workspacePatch).not.toHaveBeenCalled();
  });

  it("evaluates the fixture through the production Stats panel and Profile context", async () => {
    const plan = await buildCommunityPreviewPlan(buildPack("loudness", [PROFILE]), "loudness");

    render(<CommunityPreviewApp plan={plan} asset={plan.assets[1]} />);

    expect(screen.getByText("Stats")).toBeTruthy();
    expect(screen.getByText("Integrated")).toBeTruthy();
    expect(screen.getByText("-19.0")).toBeTruthy();
    expect(screen.getByText("True Peak Max")).toBeTruthy();
  });

  it("renders a portable Preset through the production Dock", async () => {
    const preset = {
      id: "stereo-overview",
      name: "Stereo Overview",
      ...structuredClone(DEFAULT_WORKSPACE_STATE),
      dock: {
        enabled: true,
        edge: "bottom",
        reserveSpace: false,
        height: 120,
        panelsById: { stats: { id: "stats", moduleId: "stats" } },
        panelOrder: ["stats"],
        panelSizesById: { stats: 360 },
        controlsByPanelId: {
          stats: DEFAULT_WORKSPACE_STATE.panelControlsById.stats,
        },
      },
      loudnessProfileActive: "off",
    };
    const plan = await buildCommunityPreviewPlan(buildPack("presets", [preset]), "presets");

    render(<CommunityPreviewApp plan={plan} asset={plan.assets[1]} />);

    expect(screen.getByTestId("dock-strip")).toBeTruthy();
    expect(screen.getByTestId("dock-module")).toBeTruthy();
    expect(screen.getByLabelText("Integrated -19.0")).toBeTruthy();
  });

  it("applies a portable Theme to semantic and real product scenes", async () => {
    const stored = {
      ...structuredClone(BUILTIN_THEMES_V2["plvs-dark"]),
      id: "custom-signal-amber",
      name: "Signal Amber",
    };
    const plan = await buildCommunityThemePreviewPlan({ theme: themeToPortable(stored) });

    const semantic = render(<CommunityPreviewApp plan={plan} asset={plan.assets[0]} />);
    expect(screen.getByRole("dialog", { name: "Theme Preview" })).toBeTruthy();
    expect(screen.getByText("Surfaces")).toBeTruthy();
    semantic.unmount();

    const statsAsset = plan.assets.find(({ sceneId }) => sceneId === "stats-file");
    render(<CommunityPreviewApp plan={plan} asset={statsAsset} />);
    expect(screen.getByText("Stats")).toBeTruthy();
    expect(screen.getByText("Integrated")).toBeTruthy();
  });
});
