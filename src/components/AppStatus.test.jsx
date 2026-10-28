/** @vitest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppStatusPopover, AppStatusList } from "./AppStatus.jsx";
import { buildAppStatusItems } from "../lib/appStatus.js";

describe("status details", () => {
  it("opens the complete list from a counted summary, routes actions, and closes on Escape", () => {
    const onAction = vi.fn();
    const items = buildAppStatusItems({
      layoutUnknown: true,
      update: { phase: "available", text: "Update Available" },
    });
    render(<AppStatusPopover items={items} onAction={onAction} />);
    fireEvent.mouseEnter(screen.getByRole("button", { name: /status:.*2 notices/i }).parentElement);
    expect(screen.getByRole("tooltip")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /status:.*2 notices/i }));
    expect(screen.getByRole("region", { name: "status details" })).toBeTruthy();
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open Settings" }));
    expect(onAction).toHaveBeenCalledWith("settings");
    fireEvent.click(screen.getByRole("button", { name: /status:.*2 notices/i }));
    fireEvent.click(screen.getByRole("button", { name: "View Update Details" }));
    expect(onAction).toHaveBeenCalledWith("update");
    fireEvent.click(screen.getByRole("button", { name: /status:.*2 notices/i }));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("region", { name: "status details" })).toBeNull();
  });
  it("shows full details in the shared list used by the Dock accessory", () => {
    render(
      <AppStatusList
        items={buildAppStatusItems({
          notice: {
            kind: "error",
            text: "Capture Stopped",
            details: "Reconnect the selected source.",
            requiresAttention: true,
          },
        })}
      />
    );
    expect(screen.getByText("Reconnect the selected source.")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
