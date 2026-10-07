/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from "vitest";
import { act, render, renderHook } from "@testing-library/react";
import { WorkspaceProvider } from "../workspace/WorkspaceContext.jsx";
import { BlockingEditorsProvider } from "../hooks/BlockingEditorsContext.jsx";
import { UiNavigationProvider } from "../uiNavigation/UiNavigationContext.jsx";
import { LoudnessProfileProvider } from "../hooks/LoudnessProfileContext.jsx";
import { SettingsProvider } from "../settings/SettingsContext.jsx";
import { presetsStore, settingsStore, workspaceStore } from "../persistence/index.js";
import { stubMatchMedia } from "../testing/matchMedia.js";
import {
  MeterRuntimeProvider,
  useMeterRuntime,
  useMeterRuntimeAssembly,
} from "./MeterRuntimeContext.jsx";
import { SourceActionsProvider } from "./SourceActionsContext.jsx";
import { DisplaySnapshotProvider, useDisplaySnapshot } from "./DisplaySnapshotContext.jsx";

function mount() {
  const seen = {
    assembly: /** @type {ReturnType<typeof useMeterRuntimeAssembly>} */ (null),
    runtime: /** @type {ReturnType<typeof useMeterRuntime>} */ (null),
    snapshot: /** @type {ReturnType<typeof useDisplaySnapshot>} */ (null),
  };
  function Probe() {
    seen.assembly = useMeterRuntimeAssembly();
    seen.runtime = useMeterRuntime();
    seen.snapshot = useDisplaySnapshot();
    return null;
  }
  render(
    <WorkspaceProvider>
      <MeterRuntimeProvider>
        <BlockingEditorsProvider>
          <UiNavigationProvider>
            <LoudnessProfileProvider>
              <SettingsProvider>
                <SourceActionsProvider>
                  <DisplaySnapshotProvider>
                    <Probe />
                  </DisplaySnapshotProvider>
                </SourceActionsProvider>
              </SettingsProvider>
            </LoudnessProfileProvider>
          </UiNavigationProvider>
        </BlockingEditorsProvider>
      </MeterRuntimeProvider>
    </WorkspaceProvider>
  );
  return seen;
}

describe("DisplaySnapshotProvider", () => {
  beforeEach(() => {
    localStorage.clear();
    stubMatchMedia();
    settingsStore.reset();
    workspaceStore.reset();
    presetsStore.reset();
  });

  it("reports no channels before any frame and follows the live frame's channel count", () => {
    const seen = mount();

    expect(seen.snapshot.channelCount).toBe(0);
    expect(seen.snapshot.hasHistoryData).toBe(false);

    act(() => seen.assembly.display.setAudio((current) => ({ ...current, peakDb: [-3, -4, -5] })));

    expect(seen.snapshot.channelCount).toBe(3);
    expect(seen.snapshot.displayAudio.peakDb).toEqual([-3, -4, -5]);
  });

  it("describes the transport pill: ready, then running", () => {
    const seen = mount();

    expect(seen.snapshot.sourceTransportState).toMatchObject({
      sourceLabel: "Live",
      statusLabel: "Ready",
      actionKind: "startLive",
    });

    act(() => seen.runtime.startLive());

    expect(seen.snapshot.sourceTransportState).toMatchObject({
      chromeState: "live",
      actionKind: "stopLive",
    });
  });

  it("refuses the hook outside the provider", () => {
    expect(() => renderHook(() => useDisplaySnapshot())).toThrow(
      "useDisplaySnapshot must be used inside DisplaySnapshotProvider"
    );
  });
});
