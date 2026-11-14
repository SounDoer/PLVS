/** @vitest-environment jsdom */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { UiNavigationProvider, useUiNavigation } from "../uiNavigation/UiNavigationContext.jsx";
import { FileAudioTrackDialog } from "./FileAudioTrackDialog.jsx";
import { BlockingEditorsProvider } from "../hooks/BlockingEditorsContext.jsx";
const english = {
  index: 1,
  channels: 6,
  language: "eng",
  title: "Main Mix",
  codec: "ac3",
  sampleRateHz: 48000,
};
const chinese = { index: 2, channels: 2, language: "zho", codec: "aac", sampleRateHz: 48000 };
it("selects a track without starting until confirmation and reports unknown layout as a count", () => {
  const onConfirm = vi.fn();
  render(
    <UiNavigationProvider>
      <FileAudioTrackDialog
        selection={{
          probe: {
            path: "mix.mkv",
            fileName: "mix.mkv",
            selectedTrack: english,
            audioTracks: [english, chinese],
          },
        }}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />
    </UiNavigationProvider>,
    { wrapper: BlockingEditorsProvider }
  );
  expect(screen.getByRole("radio", { name: /English/ }).getAttribute("aria-checked")).toBe("true");
  expect(screen.getByRole("radio", { name: /English/ }).textContent).toContain("6 ch");
  fireEvent.click(screen.getByRole("radio", { name: /Chinese/ }));
  expect(onConfirm).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Analyze" }));
  expect(onConfirm).toHaveBeenCalledWith(2);
});
it("cancels without confirming or changing a result", () => {
  const onConfirm = vi.fn(),
    onCancel = vi.fn();
  render(
    <UiNavigationProvider>
      <FileAudioTrackDialog
        selection={{
          probe: {
            path: "mix.mkv",
            fileName: "mix.mkv",
            selectedTrack: english,
            audioTracks: [english, chinese],
          },
        }}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    </UiNavigationProvider>,
    { wrapper: BlockingEditorsProvider }
  );
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onCancel).toHaveBeenCalledOnce();
  expect(onConfirm).not.toHaveBeenCalled();
});

it("answers a mounted audio track picker using its actual stream index", async () => {
  const tracks = [
    { index: 2, codec: "aac" },
    { index: 7, codec: "aac" },
  ];
  const onConfirm = vi.fn();
  const harness = /** @type {{ navigation?: ReturnType<typeof useUiNavigation> }} */ ({});
  function Picker() {
    harness.navigation = useUiNavigation();
    return (
      <FileAudioTrackDialog
        selection={{
          probe: {
            path: "/tmp/example.mkv",
            fileName: "example.mkv",
            selectedTrack: tracks[0],
            audioTracks: tracks,
          },
        }}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />
    );
  }
  render(
    <BlockingEditorsProvider>
      <UiNavigationProvider getRevision={() => 3}>
        <Picker />
      </UiNavigationProvider>
    </BlockingEditorsProvider>
  );
  const navigation = harness.navigation;
  if (!navigation) throw new Error("Expected the UI navigation provider to mount.");
  const { uiGeneration, surfaces } = navigation.inspectUi();
  expect(surfaces[0].choices.map(({ id }) => id)).toEqual(["cancel", "track:2", "track:7"]);
  await act(() =>
    navigation.decideSurface({
      surfaceId: surfaces[0].surfaceId,
      choice: "track:7",
      expectedRevision: 3,
      expectedUiGeneration: uiGeneration,
    })
  );
  expect(onConfirm).toHaveBeenCalledExactlyOnceWith(7);
});
