/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  emitReady: vi.fn(async () => {}),
  listenState: vi.fn(),
}));

vi.mock("../../ipc/dockAccessoryEvents.js", () => ({
  emitDockAccessoryAction: vi.fn(async () => {}),
  emitDockAccessoryPointer: vi.fn(async () => {}),
  emitDockAccessoryReady: mocks.emitReady,
  listenDockAccessoryState: mocks.listenState,
}));

import { useAccessoryClient } from "./useAccessoryClient.js";

describe("useAccessoryClient", () => {
  beforeEach(() => {
    mocks.emitReady.mockClear();
    mocks.listenState.mockReset();
  });

  it("announces ready only after the state listener is registered", async () => {
    let finishRegistration;
    mocks.listenState.mockImplementation(
      () => new Promise((resolve) => (finishRegistration = () => resolve(() => {})))
    );

    const { unmount } = renderHook(() => useAccessoryClient("dock-header"));

    expect(mocks.listenState).toHaveBeenCalledOnce();
    expect(mocks.emitReady).not.toHaveBeenCalled();

    await act(async () => finishRegistration());

    expect(mocks.emitReady).toHaveBeenCalledWith("dock-header");
    unmount();
  });
});
