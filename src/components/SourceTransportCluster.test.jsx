/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SourceTransportCluster } from "./SourceTransportCluster.jsx";

const baseState = {
  sourceLabel: "Live",
  statusLabel: "Ready",
  actionLabel: "START",
  chromeState: "ready",
  actionKind: "startLive",
};

describe("SourceTransportCluster", () => {
  it("renders source, status, and primary action", () => {
    render(
      <SourceTransportCluster
        state={baseState}
        sourceMode="live"
        onSourceModeChange={vi.fn()}
        onPrimaryAction={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: "Source: Live" })).toBeTruthy();
    expect(screen.getByText("Ready")).toBeTruthy();
    expect(screen.getByRole("button", { name: "START" })).toBeTruthy();
  });

  it("fires the primary action with the derived action kind", () => {
    const onPrimaryAction = vi.fn();
    render(
      <SourceTransportCluster
        state={baseState}
        sourceMode="live"
        onSourceModeChange={vi.fn()}
        onPrimaryAction={onPrimaryAction}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "START" }));
    expect(onPrimaryAction).toHaveBeenCalledWith("startLive");
  });

  it("opens a source menu and switches to File", () => {
    const onSourceModeChange = vi.fn();
    render(
      <SourceTransportCluster
        state={baseState}
        sourceMode="live"
        onSourceModeChange={onSourceModeChange}
        onPrimaryAction={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Source: Live" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /File/ }));
    expect(onSourceModeChange).toHaveBeenCalledWith("file");
  });

  it("marks the current source in the menu", () => {
    render(
      <SourceTransportCluster
        state={{
          ...baseState,
          sourceLabel: "File",
          statusLabel: "No file",
          actionLabel: "ANALYZE",
        }}
        sourceMode="file"
        onSourceModeChange={vi.fn()}
        onPrimaryAction={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Source: File" }));
    expect(screen.getByRole("menuitemradio", { name: /File/, checked: true })).toBeTruthy();
    expect(screen.getByRole("menuitemradio", { name: /Live/, checked: false })).toBeTruthy();
  });
});
