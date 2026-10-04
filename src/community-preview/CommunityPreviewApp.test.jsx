/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { useSpectrogram3dCanvas } from "../hooks/useSpectrogram3dCanvas";
import { settingsStore, workspaceStore } from "../persistence/index.js";
import { BUILTIN_THEMES_V2 } from "../theme/builtinThemesV2.js";
import { buildCommunityThemePreviewPlan } from "../theme/communityThemePreview.js";
import { compileTheme } from "../theme/compileTheme.js";
import { themeToPortable } from "../theme/portableTheme.js";
import { selectSpectrogramCanvasTheme } from "../theme/themeCanvasSelectors.js";
import { validatePublishablePack } from "../transfer/communityPack.js";
import { buildCommunityPreviewPlan } from "../transfer/communityPreview.js";
import { buildPack } from "../transfer/packShape.js";
import { DEFAULT_WORKSPACE_STATE } from "../workspace/constants.js";
import { CommunityPreviewApp } from "./CommunityPreviewApp.jsx";
import { publishCommunityPreviewTheme } from "./previewTheme.js";

// The 3D renderer is idle in every preview scene; observing its arguments shows which Canvas
// colours a production panel was handed.
vi.mock("../hooks/useSpectrogram3dCanvas", () => ({
  useSpectrogram3dCanvas: vi.fn(),
}));

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

  it("renders the complete production Workspace with valid Stereo Map fixture data", async () => {
    const preset = {
      id: "stereo-overview",
      name: "Stereo Overview",
      ...structuredClone(DEFAULT_WORKSPACE_STATE),
      dock: { enabled: false },
      loudnessProfileActive: "off",
    };
    const plan = await buildCommunityPreviewPlan(buildPack("presets", [preset]), "presets");

    render(<CommunityPreviewApp plan={plan} asset={plan.assets[0]} />);

    expect(screen.getByText("Stereo Map")).toBeTruthy();
    expect(screen.getByTestId("stereo-map-chart")).toBeTruthy();
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
    cleanup();

    const spectrogramAsset = plan.assets.find(({ sceneId }) => sceneId === "spectrogram-heatmap");
    render(<CommunityPreviewApp plan={plan} asset={spectrogramAsset} />);
    expect(screen.getByText("Spectrogram")).toBeTruthy();
  });

  it("renders product scenes with the previewed Theme's panel surface and Canvas colours", async () => {
    const light = {
      ...structuredClone(BUILTIN_THEMES_V2["plvs-light"]),
      id: "custom-paper-light",
      name: "Paper Light",
    };
    const plan = await buildCommunityThemePreviewPlan({
      theme: validatePublishablePack(buildPack("themes", [light]), "themes").portableItem,
    });
    const expected = compileTheme(light);
    const dark = compileTheme(BUILTIN_THEMES_V2["plvs-dark"]);
    const root = document.documentElement;
    const asset = plan.assets.find(({ sceneId }) => sceneId === "spectrogram-heatmap");

    publishCommunityPreviewTheme(plan, asset);
    const { container } = render(<CommunityPreviewApp plan={plan} asset={asset} />);

    // Panel surfaces derive from --card on the root, so a scoped copy of the tokens cannot reach them.
    expect(expected.css["--card"]).not.toBe(dark.css["--card"]);
    expect(root.style.getPropertyValue("--card")).toBe(expected.css["--card"]);
    expect(root.style.getPropertyValue("color-scheme")).toBe("light");
    expect(container.querySelector("[style*='--card']")).toBeNull();
    const canvasTheme = selectSpectrogramCanvasTheme(expected);
    expect(canvasTheme).not.toEqual(selectSpectrogramCanvasTheme(dark));
    expect(vi.mocked(useSpectrogram3dCanvas).mock.calls.at(-1)?.[0].themeColors).toEqual(
      canvasTheme
    );

    cleanup();
    publishCommunityPreviewTheme(plan, plan.assets[0]);
    expect(root.style.getPropertyValue("--card")).toBe(dark.css["--card"]);
    expect(root.style.getPropertyValue("color-scheme")).toBe("dark");
  });
});
