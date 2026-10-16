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
});
