/** @vitest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DockUpdateApp } from "./DockUpdateApp.jsx";

const { client } = vi.hoisted(() => ({ client: { payload: null, action: vi.fn() } }));
vi.mock("./useAccessoryClient.js", () => ({ useAccessoryClient: () => client }));
beforeEach(() => {
  client.action.mockClear();
  client.payload = {
    key: "details:a",
    kind: "details",
    targetId: "a",
    targetVersion: "2.0.0",
    currentVersion: "1.0.0",
    ready: true,
    installationSupported: true,
    installStatus: "idle",
    releaseNotes: "## Version A",
  };
});
describe("Dock update details", () => {
  it("shows the welcome preferences and sends changes through the owner without dismissing", () => {
    HTMLElement.prototype.scrollIntoView = vi.fn();
    client.payload = {
      ...client.payload,
      key: "setup",
      kind: "setup",
      appearance: "system",
      interfaceSize: "default",
      askToSendCrashReports: true,
      preferences: { autoCheck: true, autoDownload: false },
    };
    render(<DockUpdateApp />);
    expect(screen.getByRole("heading", { name: "Welcome to PLVS" })).toBeTruthy();
    client.action.mockClear();
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.blur(window);
    expect(client.action).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole("combobox", { name: "appearance" }), { key: "ArrowDown" });
    fireEvent.click(screen.getByRole("option", { name: "Light" }));
    expect(client.action).toHaveBeenCalledWith("welcome-appearance-change", {
      key: "setup",
      value: "plvs-light",
    });
    fireEvent.keyDown(screen.getByRole("combobox", { name: "interface size" }), {
      key: "ArrowDown",
    });
    fireEvent.click(screen.getByRole("option", { name: "Large" }));
    expect(client.action).toHaveBeenCalledWith("welcome-interface-size-change", {
      key: "setup",
      value: "large",
    });
    fireEvent.click(screen.getByRole("switch", { name: "ask to send crash reports" }));
    expect(client.action).toHaveBeenCalledWith("welcome-crash-report-change", {
      key: "setup",
      value: false,
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(client.action).toHaveBeenCalledWith("update-preferences-save", { key: "setup" });
    expect(screen.queryByRole("button", { name: "Skip" })).toBeNull();
  });
  it("acknowledges rendered content and confirms only its frozen target", () => {
    render(<DockUpdateApp />);
    expect(screen.getByText("v2.0.0 · What's new since v1.0.0")).toBeTruthy();
    expect(client.action).toHaveBeenCalledWith("update-ready", { key: "details:a" });
    fireEvent.click(screen.getByRole("button", { name: "Update and Restart" }));
    expect(client.action).toHaveBeenCalledWith("update-confirm", {
      key: "details:a",
      targetId: "a",
    });
  });
  it("stays open on blur and asks to dismiss on idle Escape", () => {
    render(<DockUpdateApp />);
    client.action.mockClear();
    fireEvent.blur(window);
    expect(client.action).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(client.action).toHaveBeenCalledWith("update-dismiss", { key: "details:a" });
  });
  it("blocks dismissal and repeated confirmation during installation", () => {
    client.payload = { ...client.payload, busy: true, installStatus: "installing" };
    render(<DockUpdateApp />);
    client.action.mockClear();
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Updating..." }));
    fireEvent.click(screen.getByRole("button", { name: "Skip This Time" }));
    expect(client.action).not.toHaveBeenCalled();
  });
  it("keeps dismissal available while a background download disables confirmation", () => {
    client.payload = { ...client.payload, ready: false, downloading: true, downloadProgress: 0.5 };
    render(<DockUpdateApp />);
    client.action.mockClear();
    const download = /** @type {HTMLButtonElement} */ (
      screen.getByRole("button", { name: "Downloading..." })
    );
    expect(download.disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(client.action).toHaveBeenCalledWith("update-dismiss", { key: "details:a" });
  });
});
