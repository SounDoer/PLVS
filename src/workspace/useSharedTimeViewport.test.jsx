/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { presetsStore, workspaceStore } from "../persistence/index.js";
import { WorkspaceProvider, useWorkspaceStore } from "./WorkspaceContext.jsx";
import { useSharedTimeViewport } from "./useSharedTimeViewport.js";

function wrapper({ children }) {
  return <WorkspaceProvider>{children}</WorkspaceProvider>;
}

describe("useSharedTimeViewport", () => {
  beforeEach(() => {
    localStorage.clear();
    workspaceStore.reset();
    presetsStore.reset();
  });

  it("writes the window and the offset to the workspace's shared time axis", () => {
    const { result } = renderHook(
      () => ({ viewport: useSharedTimeViewport(), workspace: useWorkspaceStore().state }),
      { wrapper }
    );

    act(() => result.current.viewport.setHistoryWindowSec(120));
    act(() => result.current.viewport.setHistoryOffsetSec((offset) => offset + 5));

    expect(result.current.viewport.sharedTimeViewport).toMatchObject({
      windowSec: 120,
      offsetSec: 5,
    });
    expect(result.current.workspace.axisViewports.time).toMatchObject({
      windowSec: 120,
      offsetSec: 5,
    });
  });

  it("applies two updates made before a render to the latest value", () => {
    const { result } = renderHook(() => useSharedTimeViewport(), { wrapper });

    act(() => {
      result.current.setHistoryWindowSec(90);
      result.current.setHistoryOffsetSec(7);
    });

    expect(result.current.sharedTimeViewport).toMatchObject({ windowSec: 90, offsetSec: 7 });
  });
});
