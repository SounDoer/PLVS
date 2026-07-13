import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { presetsStore, workspaceStore } from "../persistence/index.js";
import { useDockLayout } from "./useDockLayout.js";

describe("useDockLayout", () => {
  beforeEach(() => {
    workspaceStore.reset();
    presetsStore.reset();
  });

  it("starts from defaults and persists toggles to workspaceStore", () => {
    const { result } = renderHook(() => useDockLayout());
    expect(result.current.modules).toEqual(["level", "loudness", "spectrum", "correlation"]);
    act(() => result.current.toggle("spectrum"));
    expect(result.current.modules).toEqual(["level", "loudness", "correlation"]);
    expect(workspaceStore.read().dock.modules).toEqual(["level", "loudness", "correlation"]);
  });

  it("reorders and persists", () => {
    const { result } = renderHook(() => useDockLayout());
    act(() => result.current.reorder(0, 3));
    expect(result.current.modules[3]).toBe("level");
    expect(workspaceStore.read().dock.modules[3]).toBe("level");
  });

  it("setModules replaces the list (used by preset apply)", () => {
    const { result } = renderHook(() => useDockLayout());
    act(() => result.current.setModules(["spectrum"]));
    expect(result.current.modules).toEqual(["spectrum"]);
    expect(workspaceStore.read().dock.modules).toEqual(["spectrum"]);
  });

  it("marks the active preset dirty when the layout changes", () => {
    // Dock layout is part of the preset snapshot, so strip edits must dirty
    // the active preset like every other captured field. Assert on the raw
    // store patch (mirrors useAlwaysOnTop's dirty test).
    presetsStore.patch({ list: [{ id: "p1", name: "Preset" }], activeId: "p1", dirty: false });
    const { result } = renderHook(() => useDockLayout());

    act(() => result.current.toggle("spectrum"));
    expect(presetsStore.read().dirty).toBe(true);

    presetsStore.patch({ dirty: false });
    act(() => result.current.reorder(0, 2));
    expect(presetsStore.read().dirty).toBe(true);
  });

  it("exposes statsIds with defaults and persists toggles", () => {
    const { result } = renderHook(() => useDockLayout());
    expect(result.current.statsIds).toEqual(["integrated", "truePeak", "lra"]);
    act(() => result.current.toggleStat("psr"));
    expect(result.current.statsIds).toEqual(["integrated", "truePeak", "lra", "psr"]);
    expect(workspaceStore.read().dock.statsIds).toEqual(["integrated", "truePeak", "lra", "psr"]);
  });

  it("setStatsIds replaces the selection (used by preset apply)", () => {
    const { result } = renderHook(() => useDockLayout());
    act(() => result.current.setStatsIds(["lra"]));
    expect(result.current.statsIds).toEqual(["lra"]);
    expect(workspaceStore.read().dock.statsIds).toEqual(["lra"]);
  });

  it("stat toggles dirty the active preset", () => {
    presetsStore.patch({ list: [{ id: "p1", name: "Preset" }], activeId: "p1", dirty: false });
    const { result } = renderHook(() => useDockLayout());
    act(() => result.current.toggleStat("psr"));
    expect(presetsStore.read().dirty).toBe(true);
  });
});
