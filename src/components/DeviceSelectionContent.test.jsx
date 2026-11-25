/** @vitest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { expect, it, vi } from "vitest";
import { DeviceSelectionContent } from "./DeviceSelectionContent.jsx";

const mix = {
  id: "mix-00112233-4455-6677-8899-aabbccddeeff",
  name: "Playback Mix",
  members: [
    { id: "app-00112233445566778899aabbccddeeff", label: "Player" },
    { id: "app-fedcba98765432100123456789abcdef", label: "Browser" },
  ],
};

it("keeps Channels above Automatic and preserves its disclosure when switching to a Mix", () => {
  const onRole = vi.fn();
  function Picker() {
    const [expanded, onExpandedChange] = useState(false);
    const [source, onSelect] = useState("default");
    return (
      <DeviceSelectionContent
        safeAudioDeviceId={source}
        onSelect={onSelect}
        sourceMixes={{ supported: true, list: [mix] }}
        sourceChannels={{
          channelCount: 2,
          layoutId: "stereo",
          roles: ["L", "R"],
          locked: source === mix.id,
          hasOverride: false,
          expanded,
          onExpandedChange,
          onLayout: vi.fn(),
          onRole,
          onReset: vi.fn(),
        }}
      />
    );
  }
  render(<Picker />);
  const channels = screen.getByRole("button", { name: /^Channels/ });
  const automatic = screen.getByRole("button", { name: "Automatic" });
  expect(
    channels.compareDocumentPosition(automatic) & Node.DOCUMENT_POSITION_FOLLOWING
  ).toBeTruthy();
  expect(channels.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(channels);
  expect(screen.queryByRole("combobox", { name: "channel layout" })).toBeNull();
  const first = screen.getByRole("combobox", { name: "channel 1 role" });
  const second = screen.getByRole("combobox", { name: "channel 2 role" });
  expect(first.parentElement).not.toBe(second.parentElement);
  fireEvent.click(first);
  fireEvent.click(screen.getByRole("option", { name: "C" }));
  expect(onRole).toHaveBeenCalledExactlyOnceWith(0, "C");

  fireEvent.click(screen.getByRole("button", { name: /^Mixes/ }));
  fireEvent.click(screen.getByRole("button", { name: mix.name }));
  expect(channels.getAttribute("aria-expanded")).toBe("true");
  expect(channels.textContent).toContain("Read-only");
  expect(/** @type {HTMLButtonElement} */ (first).disabled).toBe(true);
  fireEvent.click(automatic);
  expect(/** @type {HTMLButtonElement} */ (first).disabled).toBe(false);
});

it("shows a layout selector for alternatives and confirms resetting overrides", () => {
  const onLayout = vi.fn();
  const onReset = vi.fn();
  render(
    <DeviceSelectionContent
      onSelect={vi.fn()}
      sourceChannels={{
        channelCount: 8,
        layoutId: "custom",
        roles: ["L", "R", "C", "LFE", "Lb", "Rb", "Ls", "Rs"],
        locked: false,
        hasOverride: true,
        expanded: true,
        onExpandedChange: vi.fn(),
        onLayout,
        onRole: vi.fn(),
        onReset,
      }}
    />
  );
  fireEvent.click(screen.getByRole("combobox", { name: "channel layout" }));
  expect(screen.getByRole("option", { name: "7.1 Wide" })).toBeTruthy();
  fireEvent.click(screen.getByRole("option", { name: "5.1.2" }));
  expect(onLayout).toHaveBeenCalledExactlyOnceWith("5.1.2");
  fireEvent.click(screen.getByRole("button", { name: "Reset channel labels" }));
  expect(onReset).not.toHaveBeenCalled();
  fireEvent.click(screen.getByLabelText("Confirm reset channel labels"));
  expect(onReset).toHaveBeenCalledOnce();
});

it("shows the selected source in the group header only while collapsed", () => {
  const { container } = render(
    <DeviceSelectionContent
      audioOutputs={[{ id: "output", label: "Speakers" }]}
      audioInputs={[{ id: "input", label: "Microphone" }]}
      captureApplications={mix.members}
      safeAudioDeviceId={mix.id}
      sourceMixes={{ supported: true, list: [mix] }}
      onSelect={vi.fn()}
    />
  );
  expect(
    [...container.querySelectorAll('[data-ui-target^="source-group:"]')].map((element) =>
      element.getAttribute("data-ui-target")
    )
  ).toEqual([
    "source-group:output",
    "source-group:input",
    "source-group:applications",
    "source-group:mixes",
  ]);
  const group = screen.getByRole("button", { name: /^Mixes/ });
  expect(group.textContent).not.toContain(mix.name);
  expect(screen.getByRole("button", { name: mix.name }).getAttribute("aria-current")).toBe("true");
  fireEvent.click(group);
  expect(group.textContent).toContain(mix.name);
  expect(screen.queryByRole("button", { name: mix.name })).toBeNull();
});

it("edits and confirms deletion directly on the row without selecting the Mix", () => {
  const open = vi.fn();
  const remove = vi.fn();
  const select = vi.fn();
  render(
    <DeviceSelectionContent
      captureApplications={mix.members}
      safeAudioDeviceId={mix.id}
      sourceMixes={{ supported: true, list: [mix], open, remove }}
      onSelect={select}
    />
  );
  fireEvent.click(screen.getByRole("button", { name: "edit Playback Mix" }));
  expect(open).toHaveBeenCalledWith(mix);
  fireEvent.click(screen.getByRole("button", { name: "delete Playback Mix" }));
  expect(remove).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "cancel delete Playback Mix" }));
  expect(remove).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "delete Playback Mix" }));
  fireEvent.click(screen.getByRole("button", { name: "confirm delete Playback Mix" }));
  expect(remove).toHaveBeenCalledWith(mix);
  expect(select).not.toHaveBeenCalled();
});

it("selects whole input and output devices even when they have several channels", () => {
  const input = { id: `cap-${"3".repeat(32)}`, label: "Interface", channels: 10 };
  const output = { id: `lb-${"4".repeat(32)}`, label: "Speakers", channels: 6 };
  const onSelect = vi.fn();
  render(
    <DeviceSelectionContent
      audioInputs={[input]}
      audioOutputs={[output]}
      safeAudioDeviceId="default"
      onSelect={onSelect}
    />
  );
  fireEvent.click(screen.getByRole("button", { name: /^Input/ }));
  fireEvent.click(screen.getByRole("button", { name: "Interface" }));
  expect(onSelect).toHaveBeenLastCalledWith(input.id);
  fireEvent.click(screen.getByRole("button", { name: /^Output/ }));
  fireEvent.click(screen.getByRole("button", { name: "Speakers" }));
  expect(onSelect).toHaveBeenLastCalledWith(output.id);
  expect(screen.queryByRole("button", { name: /channels for/ })).toBeNull();
});

it("uses a singular source count for a one-channel Mix", () => {
  const input = { id: `cap-${"3".repeat(32)}`, label: "Cable", channels: 2 };
  const solo = { ...mix, members: [], input: { id: input.id, label: input.label, channels: [0] } };
  render(
    <DeviceSelectionContent
      audioInputs={[input]}
      safeAudioDeviceId={solo.id}
      sourceMixes={{ supported: true, list: [solo] }}
      onSelect={vi.fn()}
    />
  );
  expect(screen.getByRole("button", { name: solo.name }).textContent).toContain(
    "1 Source · Stereo"
  );
});

it("shows single-line application names and reveals distinct window context on focus", () => {
  const captureApplications = [
    { id: `app-${"1".repeat(32)}`, label: "AppleMusic", windowTitle: "Apple Music" },
    { id: `app-${"2".repeat(32)}`, label: "chrome", windowTitle: "Audio Meter Reference" },
  ];
  render(<DeviceSelectionContent captureApplications={captureApplications} onSelect={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: /^Applications/ }));
  const music = screen.getByRole("button", { name: "Apple Music application audio" });
  expect(music.textContent).toBe("Apple Music");
  fireEvent.focus(music);
  expect(screen.queryByRole("tooltip")).toBeNull();
  const chrome = screen.getByRole("button", { name: "Chrome application audio" });
  expect(chrome.textContent).toBe("Chrome");
  fireEvent.focus(chrome);
  expect(screen.getByRole("tooltip").textContent).toBe("Audio Meter Reference");
});
