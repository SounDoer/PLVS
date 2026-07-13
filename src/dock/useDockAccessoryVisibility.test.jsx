import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setDockAccessories } from "../ipc/commands.js";
import { useDockAccessoryVisibility } from "./useDockAccessoryVisibility.js";

vi.mock("../ipc/env.js", () => ({ isTauri: () => true }));
vi.mock("../ipc/commands.js", () => ({ setDockAccessories: vi.fn().mockResolvedValue(undefined) }));

describe("useDockAccessoryVisibility", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("shows on strip enter and hides 300ms after both surfaces are left", async () => {
    const { result } = renderHook(() =>
      useDockAccessoryVisibility({ active: true, edge: "bottom" })
    );
    act(() => result.current.onStripPointerEnter());
    await act(async () => Promise.resolve());
    expect(result.current.headerVisible).toBe(true);
    act(() => result.current.onStripPointerLeave());
    act(() => vi.advanceTimersByTime(299));
    expect(result.current.headerVisible).toBe(true);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.headerVisible).toBe(false);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(setDockAccessories).toHaveBeenLastCalledWith(
      expect.objectContaining({ headerVisible: false })
    );
  });

  it("keeps header and editor visible until the editor closes", () => {
    const { result } = renderHook(() => useDockAccessoryVisibility({ active: true, edge: "top" }));
    act(() => result.current.openEditor("modules"));
    expect(result.current.editorView).toBe("modules");
    expect(result.current.headerVisible).toBe(true);
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.headerVisible).toBe(true);
    act(() => result.current.closeEditor());
    act(() => vi.advanceTimersByTime(300));
    expect(result.current.editorView).toBeNull();
    expect(result.current.headerVisible).toBe(false);
  });
});
