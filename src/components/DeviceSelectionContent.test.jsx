/** @vitest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
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

it("shows the selected source in the group header only while collapsed", () => {
  render(
    <DeviceSelectionContent
      captureApplications={mix.members}
      safeAudioDeviceId={mix.id}
      sourceMixes={{ supported: true, list: [mix] }}
      onSelect={vi.fn()}
    />
  );
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
