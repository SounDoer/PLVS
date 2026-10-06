/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { MeterRuntimeProvider, useMeterRuntime } from "../runtime/MeterRuntimeContext.jsx";
import { BlockingEditorsProvider, useBlockingEditor } from "./BlockingEditorsContext.jsx";
import { SceneGuardProvider, useSceneGuard } from "./SceneGuardContext.jsx";
import {
  SCENE_OPERATIONS,
  SceneOperationBlockedError,
  SceneOperationUnavailableError,
} from "../lib/sceneOperations.js";

function wrapper({ children }) {
  return (
    <MeterRuntimeProvider>
      <BlockingEditorsProvider>
        <SceneGuardProvider>{children}</SceneGuardProvider>
      </BlockingEditorsProvider>
    </MeterRuntimeProvider>
  );
}

describe("SceneGuardProvider", () => {
  it("allows scene operations in live mode with no editor open", () => {
    const { result } = renderHook(() => useSceneGuard(), { wrapper });

    expect(result.current.activeBlockingEditors).toEqual([]);
    expect(() =>
      result.current.assertSceneOperationAllowed(SCENE_OPERATIONS.dockEnter)
    ).not.toThrow();
  });

  it("refuses dock entry in file mode", () => {
    const { result } = renderHook(() => ({ guard: useSceneGuard(), runtime: useMeterRuntime() }), {
      wrapper,
    });

    act(() => result.current.runtime.switchSource("file"));

    expect(() =>
      result.current.guard.assertSceneOperationAllowed(SCENE_OPERATIONS.dockEnter)
    ).toThrow(SceneOperationUnavailableError);
  });

  it("refuses every scene operation while a blocking editor is open", () => {
    const { result } = renderHook(
      () => {
        useBlockingEditor("theme", true);
        return useSceneGuard();
      },
      { wrapper }
    );

    expect(result.current.activeBlockingEditors).toEqual(["theme"]);
    expect(() => result.current.assertSceneOperationAllowed(SCENE_OPERATIONS.presetApply)).toThrow(
      SceneOperationBlockedError
    );
  });

  it("refuses the hook outside the provider", () => {
    expect(() => renderHook(() => useSceneGuard())).toThrow(
      "useSceneGuard must be used inside SceneGuardProvider"
    );
  });
});
