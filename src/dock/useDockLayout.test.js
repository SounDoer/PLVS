import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { workspaceStore } from "../persistence/index.js";
import { useDockLayout } from "./useDockLayout.js";

describe("useDockLayout", () => {
  beforeEach(() => {
    workspaceStore.reset();
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
  });
});
