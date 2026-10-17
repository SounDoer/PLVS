/** @vitest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  UpdatePreferencesControls,
  UpdatePreferencesSettings,
  UpdateSetupContent,
} from "./UpdatePreferencesControls.jsx";

describe("update preference controls", () => {
  it("turning checking off explicitly clears downloading; checking on does not restore it", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <UpdatePreferencesControls
        preferences={{ autoCheck: true, autoDownload: true }}
        onChange={onChange}
        installationSupported
      />
    );
    fireEvent.click(screen.getByRole("switch", { name: "automatically check for updates" }));
    expect(onChange).toHaveBeenLastCalledWith({ autoCheck: false, autoDownload: false });
    rerender(
      <UpdatePreferencesControls
        preferences={{ autoCheck: false, autoDownload: false }}
        onChange={onChange}
        installationSupported
      />
    );
    expect(
      screen
        .getByRole("switch", { name: "automatically download updates" })
        .hasAttribute("disabled")
    ).toBe(true);
    fireEvent.click(screen.getByRole("switch", { name: "automatically check for updates" }));
    expect(onChange).toHaveBeenLastCalledWith({ autoCheck: true });
  });
  it("does not offer automatic installation for a Portable copy", () => {
    render(
      <UpdatePreferencesControls
        preferences={{ autoCheck: true, autoDownload: false }}
        onChange={vi.fn()}
      />
    );
    expect(
      screen
        .getByRole("switch", { name: "automatically download updates" })
        .hasAttribute("disabled")
    ).toBe(true);
  });
  it("reports persistence failure without swallowing it", async () => {
    render(
      <UpdatePreferencesSettings
        preferences={{ autoCheck: true, autoDownload: false }}
        installationSupported
        onChange={async () => {
          throw new Error("Disk full");
        }}
      />
    );
    fireEvent.click(screen.getByRole("switch", { name: "automatically download updates" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Disk full");
  });
});

it("explains the check dependency and read-only installation separately", () => {
  const { rerender } = render(
    <UpdatePreferencesControls
      preferences={{ autoCheck: false, autoDownload: false }}
      onChange={vi.fn()}
      installationSupported
    />
  );
  expect(screen.getByRole("button", { name: /Turn on Auto Check/ })).toBeTruthy();
  rerender(
    <UpdatePreferencesControls
      preferences={{ autoCheck: true, autoDownload: false }}
      onChange={vi.fn()}
      installationUnavailableReason="Move PLVS to Applications."
    />
  );
  expect(screen.getByRole("button", { name: /Move PLVS to Applications/ })).toBeTruthy();
  expect(screen.getByText("Move PLVS to Applications.")).toBeTruthy();
  expect(
    screen.getByRole("switch", { name: "automatically download updates" }).hasAttribute("disabled")
  ).toBe(true);
});
it("opens privacy only on an explicit action without saving update preferences", () => {
  const onPrivacy = vi.fn(),
    onSave = vi.fn(),
    onChange = vi.fn();
  render(
    <UpdateSetupContent
      preferences={{ autoCheck: true, autoDownload: false }}
      onChange={onChange}
      onSave={onSave}
      onSkip={vi.fn()}
      onPrivacy={onPrivacy}
      installationSupported
      busy={false}
      error={null}
    />
  );
  expect(onPrivacy).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Privacy Policy" }));
  expect(onPrivacy).toHaveBeenCalledOnce();
  expect(onSave).not.toHaveBeenCalled();
  expect(onChange).not.toHaveBeenCalled();
});
