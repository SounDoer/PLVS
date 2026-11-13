/** @vitest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppStatusPopover, AppStatusList } from "./AppStatus.jsx";
import { buildAppStatusItems } from "../lib/appStatus.js";
import { dockUpdateStatus } from "../dock/dockUpdateStatus.js";

describe("status details", () => {
  it("offers a check retry without a target and disappears once the check recovers", () => {
    const onAction = vi.fn();
    const items = buildAppStatusItems({
      update: dockUpdateStatus({
        updateInfo: { status: "unavailable", hasUpdate: false },
      }),
    });
    const { rerender } = render(<AppStatusPopover items={items} onAction={onAction} />);
    fireEvent.click(screen.getByRole("button", { name: "status: Update Check Failed" }));
    expect(screen.queryByRole("button", { name: "View Update Details" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Check Again" }));
    expect(onAction).toHaveBeenCalledWith("check-update");
    expect(screen.queryByRole("region", { name: "status details" })).toBeNull();
    rerender(
      <AppStatusPopover
        items={buildAppStatusItems({
          update: dockUpdateStatus({ updateInfo: { status: "ok", hasUpdate: false } }),
        })}
        onAction={onAction}
      />
    );
    expect(screen.queryByRole("button", { name: /status:/ })).toBeNull();
  });

  it("opens the complete list from a counted summary, routes actions, and closes on Escape", () => {
    const onAction = vi.fn();
    const items = buildAppStatusItems({
      layoutUnknown: true,
      update: { phase: "available", text: "Update Available" },
    });
    render(<AppStatusPopover items={items} onAction={onAction} />);
    // No hover tip: the details live in the list, which a narrow Dock toolbar cannot clip.
    fireEvent.mouseEnter(screen.getByRole("button", { name: /status:.*2 notices/i }));
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /status:.*2 notices/i }));
    expect(screen.getByRole("region", { name: "status details" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open Settings" }));
    expect(onAction).toHaveBeenCalledWith("settings");
    fireEvent.click(screen.getByRole("button", { name: /status:.*2 notices/i }));
    fireEvent.click(screen.getByRole("button", { name: "View Update Details" }));
    expect(onAction).toHaveBeenCalledWith("update");
    fireEvent.click(screen.getByRole("button", { name: /status:.*2 notices/i }));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("region", { name: "status details" })).toBeNull();
  });
  it("offers troubleshooting alongside the channel settings action", () => {
    const onHelp = vi.fn();
    render(<AppStatusList items={buildAppStatusItems({ layoutUnknown: true })} onHelp={onHelp} />);
    expect(screen.getByRole("button", { name: "Open Settings" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Troubleshooting" }));
    expect(onHelp).toHaveBeenCalledWith("channel-layout-unknown");
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
