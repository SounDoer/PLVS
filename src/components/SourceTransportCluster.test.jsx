/** @vitest-environment jsdom */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SourceTransportCluster } from "./SourceTransportCluster.jsx";

const currentDir = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(currentDir, "SourceTransportCluster.jsx"), "utf8");

const baseState = {
  sourceLabel: "Live",
  statusLabel: "Ready",
  actionLabel: "START",
  chromeState: "ready",
  actionKind: "startLive",
};

describe("SourceTransportCluster", () => {
  it("uses typography tokens instead of hard-coded transport text sizes", () => {
    expect(source).toContain("text-[length:var(--ui-fs-status)]");
    expect(source).toContain("text-[length:var(--ui-fs-metric-meta)]");
    expect(source).not.toContain("text-[11px]");
    expect(source).not.toContain("text-[11.5px]");
    expect(source).not.toContain("text-xs");
  });

  it("uses semantic borders instead of hard-coded white tints", () => {
    expect(source).toContain("border-border");
    expect(source).not.toContain("border-white/");
  });

  it("keeps a solid primary accent for the ready action segment", () => {
    expect(source).toContain("bg-primary text-primary-foreground");
    expect(source).not.toContain("bg-primary/15 text-primary");
  });

  it("uses compact header control sizing", () => {
    expect(source).toContain("h-7");
    expect(source).toContain("px-2.5");
    expect(source).toContain("px-3");
    expect(source).not.toContain("h-8");
    expect(source).not.toContain("px-3.5");
  });

  it("renders source, status, and action as one continuous pill", () => {
    expect(source).toContain("overflow-hidden rounded-full");
    expect(source).toContain("p-0.5");
    expect(source).toContain("rounded-full px-3");
    expect(source).not.toContain("relative inline-flex items-center gap-1.5");
    expect(source).not.toContain("border-l border-current/20");
    expect(source).not.toContain("rounded-md px-3 text-[length:var(--ui-fs-status)]");
  });

  it("sizes the source menu from content and trigger instead of a fixed width", () => {
    expect(source).toContain("min-w-[var(--radix-popover-trigger-width)]");
    expect(source).not.toContain("w-44");
    expect(source).not.toContain("w-72");
  });

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
    fireEvent.click(screen.getByRole("menuitemradio", { name: "FILE" }));
    expect(onSourceModeChange).toHaveBeenCalledWith("file");
  });

  it("renders compact source options without header or descriptions", () => {
    render(
      <SourceTransportCluster
        state={baseState}
        sourceMode="live"
        onSourceModeChange={vi.fn()}
        onPrimaryAction={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Source: Live" }));
    expect(screen.queryByText("Source")).toBeNull();
    expect(screen.queryByText("System playback / input monitoring")).toBeNull();
    expect(screen.queryByText("Analyze a local audio or video file")).toBeNull();
    expect(screen.getByRole("menuitemradio", { name: "LIVE" })).toBeTruthy();
    expect(screen.getByRole("menuitemradio", { name: "FILE" })).toBeTruthy();
  });

  it("closes the source menu when clicking outside", async () => {
    render(
      <>
        <SourceTransportCluster
          state={baseState}
          sourceMode="live"
          onSourceModeChange={vi.fn()}
          onPrimaryAction={vi.fn()}
        />
        <button type="button">Outside</button>
      </>
    );

    fireEvent.click(screen.getByRole("button", { name: "Source: Live" }));
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.pointerDown(document.body);
    fireEvent.mouseDown(screen.getByRole("button", { name: "Outside" }));
    fireEvent.click(screen.getByRole("button", { name: "Outside" }));
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
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
    expect(screen.getByRole("menuitemradio", { name: "FILE", checked: true })).toBeTruthy();
    expect(screen.getByRole("menuitemradio", { name: "LIVE", checked: false })).toBeTruthy();
  });
});
