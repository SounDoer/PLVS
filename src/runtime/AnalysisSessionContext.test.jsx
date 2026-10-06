/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from "vitest";
import { act, render, renderHook } from "@testing-library/react";
import { WorkspaceProvider } from "../workspace/WorkspaceContext.jsx";
import { BlockingEditorsProvider } from "../hooks/BlockingEditorsContext.jsx";
import { UiNavigationProvider } from "../uiNavigation/UiNavigationContext.jsx";
import { LoudnessProfileProvider } from "../hooks/LoudnessProfileContext.jsx";
import { SettingsProvider, useAppSettings } from "../settings/SettingsContext.jsx";
import { SceneGuardProvider } from "../hooks/SceneGuardContext.jsx";
import { DockProvider } from "../dock/DockContext.jsx";
import { presetsStore, settingsStore, workspaceStore } from "../persistence/index.js";
import { stubMatchMedia } from "../testing/matchMedia.js";
import { MeterRuntimeProvider, useMeterRuntimeAssembly } from "./MeterRuntimeContext.jsx";
import { SourceActionsProvider } from "./SourceActionsContext.jsx";
import { DisplaySnapshotProvider } from "./DisplaySnapshotContext.jsx";
import { AnalysisSessionProvider, useAnalysisSession } from "./AnalysisSessionContext.jsx";

function Providers({ children }) {
  return (
    <WorkspaceProvider>
      <MeterRuntimeProvider>
        <BlockingEditorsProvider>
          <UiNavigationProvider>
            <LoudnessProfileProvider>
              <SettingsProvider>
                <SceneGuardProvider>
                  <DockProvider>
                    <SourceActionsProvider>
                      <DisplaySnapshotProvider>
                        <AnalysisSessionProvider>{children}</AnalysisSessionProvider>
                      </DisplaySnapshotProvider>
                    </SourceActionsProvider>
                  </DockProvider>
                </SceneGuardProvider>
              </SettingsProvider>
            </LoudnessProfileProvider>
          </UiNavigationProvider>
        </BlockingEditorsProvider>
      </MeterRuntimeProvider>
    </WorkspaceProvider>
  );
}

function mount() {
  const seen = {
    renders: 0,
    session: /** @type {ReturnType<typeof useAnalysisSession>} */ (null),
    assembly: /** @type {ReturnType<typeof useMeterRuntimeAssembly>} */ (null),
    settings: /** @type {ReturnType<typeof useAppSettings>} */ (null),
  };
  function Probe() {
    seen.session = useAnalysisSession();
    seen.assembly = useMeterRuntimeAssembly();
    seen.settings = useAppSettings();
    return null;
  }
  function SessionOnly() {
    useAnalysisSession();
    seen.renders += 1;
    return null;
  }
  render(
    <Providers>
      <Probe />
      <SessionOnly />
    </Providers>
  );
  return seen;
}

describe("AnalysisSessionProvider", () => {
  beforeEach(() => {
    localStorage.clear();
    stubMatchMedia();
    settingsStore.reset();
    workspaceStore.reset();
    presetsStore.reset();
  });

  it("offers stereo choices while idle and follows the channel count", () => {
    const seen = mount();

    expect(seen.session.channelCount).toBe(0);
    expect(seen.session.spectrumChannelOptions.length).toBeGreaterThan(0);

    act(() =>
      seen.assembly.display.setAudio((current) => ({
        ...current,
        peakDb: [-1, -2, -3, -4, -5, -6],
      }))
    );

    expect(seen.session.channelCount).toBe(6);
    expect(seen.session.channelLabelRuntime.channelAutoLabels).toHaveLength(6);
  });

  it("stores a custom channel label for the current channel count and resets it", () => {
    const seen = mount();
    act(() => seen.assembly.display.setAudio((current) => ({ ...current, peakDb: [-1, -2] })));

    act(() => seen.session.setChannelLabelToken(0, "C"));
    expect(seen.settings.channelLabelOverrides[2][0]).toBe("C");
    expect(seen.session.channelLabelRuntime.channelLabelOverride).toBeTruthy();

    act(() => seen.session.resetChannelLabels());
    expect(seen.settings.channelLabelOverrides[2]).toBeUndefined();
  });

  it("keeps its consumers still while frames with the same channel count arrive", () => {
    const seen = mount();
    act(() => seen.assembly.display.setAudio((current) => ({ ...current, peakDb: [-1, -2] })));
    const rendersAfterFirstFrame = seen.renders;

    act(() => seen.assembly.display.setAudio((current) => ({ ...current, peakDb: [-7, -8] })));
    act(() => seen.assembly.display.setAudio((current) => ({ ...current, tpMax: -3 })));

    expect(seen.renders).toBe(rendersAfterFirstFrame);
  });

  it("refuses the hook outside the provider", () => {
    expect(() => renderHook(() => useAnalysisSession())).toThrow(
      "useAnalysisSession must be used inside AnalysisSessionProvider"
    );
  });
});
