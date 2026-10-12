/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { useSpectrogram3dCanvas } from "../hooks/useSpectrogram3dCanvas";
import { BUILTIN_THEMES_V2 } from "../theme/builtinThemesV2.js";
import { buildSharesetsThemePreviewPlan } from "../theme/sharesetsThemePreview.js";
import { compileTheme } from "../theme/compileTheme.js";
import { themeToPortable } from "../theme/portableTheme.js";
import { selectSpectrogramCanvasTheme } from "../theme/themeCanvasSelectors.js";
import { validatePublishablePack } from "../transfer/sharesetsPack.js";
import { buildSharesetsPreviewPlan } from "../transfer/sharesetsPreview.js";
import { SHARESETS_PREVIEW_FIXTURE_V5 } from "../transfer/fixtures/sharesetsPreviewV5.js";
import { buildPack } from "../transfer/packShape.js";
import { DEFAULT_WORKSPACE_STATE } from "../workspace/constants.js";
import { SharesetsPreviewApp } from "./SharesetsPreviewApp.jsx";
import { MULTICHANNEL_MONITORING_PRESET } from "./multichannelMonitoringPreset.js";
import { publishSharesetsPreviewTheme } from "./previewTheme.js";

// The 3D renderer is idle in every preview scene; observing its arguments shows which Canvas
// colours a production panel was handed.
vi.mock("../hooks/useSpectrogram3dCanvas", () => ({
  useSpectrogram3dCanvas: vi.fn(),
}));

beforeAll(() => {
  class ResizeObserverStub {
    observe() {}
    disconnect() {}
    unobserve() {}
  }
  globalThis.ResizeObserver = ResizeObserverStub;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Sharesets preview browser harness", () => {
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
    const plan = await buildSharesetsPreviewPlan(buildPack("presets", [preset]), "presets");

    render(<SharesetsPreviewApp plan={plan} asset={plan.assets[1]} />);

    expect(screen.getByTestId("dock-strip")).toBeTruthy();
    expect(screen.getByTestId("dock-module")).toBeTruthy();
    expect(
      screen.getByLabelText(
        `Integrated ${SHARESETS_PREVIEW_FIXTURE_V5.measurementFrame.loudness.integratedLufs.toFixed(1)}`
      )
    ).toBeTruthy();
  });

  it("renders the complete production Workspace with valid Stereo Map fixture data", async () => {
    const preset = {
      id: "stereo-overview",
      name: "Stereo Overview",
      ...structuredClone(DEFAULT_WORKSPACE_STATE),
      dock: { enabled: false },
      loudnessProfileActive: "off",
    };
    const plan = await buildSharesetsPreviewPlan(buildPack("presets", [preset]), "presets");

    render(<SharesetsPreviewApp plan={plan} asset={plan.assets[0]} />);

    expect(screen.getByText("Stereo Map")).toBeTruthy();
    expect(screen.getByTestId("stereo-map-chart")).toBeTruthy();
  });

  it("renders the official Multichannel Monitoring Preset with its 5.1 fixture", async () => {
    const plan = await buildSharesetsPreviewPlan(
      {
        app: "PLVS",
        kind: "preset-pack",
        version: 2,
        items: [{ id: "multichannel-monitoring", ...MULTICHANNEL_MONITORING_PRESET }],
        dependencies: [],
      },
      "presets"
    );

    publishSharesetsPreviewTheme(plan, plan.assets[0]);
    render(<SharesetsPreviewApp plan={plan} asset={plan.assets[0]} />);

    expect(screen.getAllByText("LFE").length).toBeGreaterThan(0);
    expect(screen.getByText("Spectrum")).toBeTruthy();
    expect(screen.getByText("Waveform")).toBeTruthy();
    expect(screen.getByText("Vectorscope")).toBeTruthy();
    expect(screen.getByText("Stats")).toBeTruthy();
  });

  it("applies a portable Theme to semantic and real product scenes", async () => {
    const stored = {
      ...structuredClone(BUILTIN_THEMES_V2["plvs-dark"]),
      id: "custom-signal-amber",
      name: "Signal Amber",
    };
    const plan = await buildSharesetsThemePreviewPlan({ theme: themeToPortable(stored) });

    const semanticAsset = plan.assets.find(({ id }) => id === "semantic-overview");
    const semantic = render(<SharesetsPreviewApp plan={plan} asset={semanticAsset} />);
    expect(screen.getByRole("dialog", { name: "Theme Preview" })).toBeTruthy();
    expect(screen.getByText("Surfaces")).toBeTruthy();
    semantic.unmount();

    const multichannelAsset = plan.assets.find(
      ({ id }) => id === "product-multichannel-monitoring"
    );
    render(<SharesetsPreviewApp plan={plan} asset={multichannelAsset} />);
    expect(screen.getByText("Stats")).toBeTruthy();
    expect(screen.getByText("Integrated")).toBeTruthy();
    expect(screen.getByText("Spectrum")).toBeTruthy();
    expect(screen.getByText("Vectorscope")).toBeTruthy();
  });

  it("renders the Theme multichannel scene from the measured 5.1 fixture", async () => {
    const plan = await buildSharesetsThemePreviewPlan({
      theme: themeToPortable(BUILTIN_THEMES_V2["plvs-dark"]),
    });
    const asset = plan.assets.find(({ id }) => id === "product-multichannel-monitoring");
    const preview = render(<SharesetsPreviewApp plan={plan} asset={asset} />);

    expect(screen.getAllByText("L").length).toBeGreaterThan(0);
    expect(screen.getAllByText("LFE").length).toBeGreaterThan(0);
    expect(preview.container.querySelector('[data-spectrum-live="primary"]')).toBeTruthy();
    expect(screen.getByText("Multichannel Monitoring")).toBeTruthy();
  });

  it("renders workspace Theme scenes inside the real Header and Footer shell", async () => {
    const plan = await buildSharesetsThemePreviewPlan({
      theme: themeToPortable(BUILTIN_THEMES_V2["plvs-dark"]),
    });
    const workspaceAsset = plan.assets.find(({ id }) => id === "product-workspace-file");
    const snapshotAsset = plan.assets.find(({ id }) => id === "product-workspace-snapshot");

    const workspace = render(<SharesetsPreviewApp plan={plan} asset={workspaceAsset} />);
    expect(screen.getByRole("button", { name: "Source: Live" })).toBeTruthy();
    expect(screen.getByText("00:01:00")).toBeTruthy();
    expect(screen.getByRole("button", { name: "STOP" })).toBeTruthy();
    expect(screen.getByText("Source")).toBeTruthy();
    expect(screen.getByText("Preview Audio")).toBeTruthy();
    expect(screen.getAllByText("Loudness")).toHaveLength(2);
    expect(screen.getByText("Default")).toBeTruthy();
    expect(screen.getByText("PLVS Default")).toBeTruthy();
    workspace.unmount();

    render(<SharesetsPreviewApp plan={plan} asset={snapshotAsset} />);
    expect(screen.getByRole("button", { name: "LIVE" })).toBeTruthy();
  });

  it("renders product scenes with the previewed Theme's panel surface and Canvas colours", async () => {
    const light = {
      ...structuredClone(BUILTIN_THEMES_V2["plvs-light"]),
      id: "custom-paper-light",
      name: "Paper Light",
    };
    const plan = await buildSharesetsThemePreviewPlan({
      theme: validatePublishablePack(buildPack("themes", [light]), "themes").portableItem,
    });
    const expected = compileTheme(light);
    const dark = compileTheme(BUILTIN_THEMES_V2["plvs-dark"]);
    const root = document.documentElement;
    const asset = plan.assets.find(({ id }) => id === "product-workspace-file");

    publishSharesetsPreviewTheme(plan, asset);
    const { container } = render(<SharesetsPreviewApp plan={plan} asset={asset} />);

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
    publishSharesetsPreviewTheme(
      plan,
      plan.assets.find(({ id }) => id === "semantic-overview")
    );
    expect(root.style.getPropertyValue("--card")).toBe(dark.css["--card"]);
    expect(root.style.getPropertyValue("color-scheme")).toBe("dark");
  });
});
