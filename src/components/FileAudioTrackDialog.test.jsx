/** @vitest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { UiNavigationProvider } from "../uiNavigation/UiNavigationContext.jsx";
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
