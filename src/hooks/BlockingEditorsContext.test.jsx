/** @vitest-environment jsdom */
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  BlockingEditorsProvider,
  useBlockingEditor,
  useBlockingEditors,
} from "./BlockingEditorsContext.jsx";
import { SCENE_OPERATIONS } from "../lib/sceneOperations.js";

function wrapper({ children }) {
  return <BlockingEditorsProvider>{children}</BlockingEditorsProvider>;
}

// Registration is flipped by re-rendering with a different `active`, the way a real editor does,
// never by calling the registry directly.
function renderRegistry(initial = { profile: false, theme: false }) {
  let setOpenEditors;
  const view = renderHook(
    () => {
      const [open, setOpen] = useState(initial);
      setOpenEditors = setOpen;
      useBlockingEditor("loudnessProfile", open.profile);
      useBlockingEditor("theme", open.theme);
      return useBlockingEditors();
    },
    { wrapper }
  );
  return { ...view, setOpen: (next) => act(() => setOpenEditors(next)) };
}

describe("BlockingEditorsProvider", () => {
  it("reports nothing active until an editor registers", () => {
    const { result } = renderRegistry();
    expect(result.current.activeBlockingEditors).toEqual([]);
    expect(() =>
      result.current.assertSceneOperationAllowed(SCENE_OPERATIONS.presetApply)
    ).not.toThrow();
  });

  it("refuses a scene operation while an editor is open and names it", () => {
    const { result, setOpen } = renderRegistry();
    setOpen({ profile: true, theme: false });

    expect(result.current.activeBlockingEditors).toEqual(["loudnessProfile"]);
    let thrown = null;
    try {
      result.current.assertSceneOperationAllowed(SCENE_OPERATIONS.presetApply);
    } catch (error) {
      thrown = error;
    }
    expect(thrown?.name).toBe("SceneOperationBlockedError");
    expect(thrown?.code).toBe("editorActive");
    expect(thrown?.operation).toBe("preset.apply");
    expect(thrown?.editors).toEqual(["loudnessProfile"]);
    // The message is user copy; nothing may branch on it.
    expect(thrown?.message).toBe("Finish or cancel the active editor first.");
  });

  it("lists every open editor and clears as each one closes", () => {
    const { result, setOpen } = renderRegistry();
    setOpen({ profile: true, theme: true });
    expect(result.current.activeBlockingEditors).toEqual(["loudnessProfile", "theme"]);

    setOpen({ profile: false, theme: true });
    expect(result.current.activeBlockingEditors).toEqual(["theme"]);
    expect(() => result.current.assertSceneOperationAllowed(SCENE_OPERATIONS.dockEnter)).toThrow();

    setOpen({ profile: false, theme: false });
    expect(result.current.activeBlockingEditors).toEqual([]);
    expect(() =>
      result.current.assertSceneOperationAllowed(SCENE_OPERATIONS.dockEnter)
    ).not.toThrow();
  });

  it("survives two surfaces registering the same id", () => {
    const { result } = renderHook(
      () => {
        useBlockingEditor("theme", true);
        useBlockingEditor("theme", true);
        return useBlockingEditors();
      },
      { wrapper }
    );
    // Counted, not flagged: StrictMode mounts effects twice and one unmount must not clear it.
    expect(result.current.activeBlockingEditors).toEqual(["theme"]);
  });

  it("throws when the consumer is rendered without the provider", () => {
    expect(() => renderHook(() => useBlockingEditors())).toThrow(/BlockingEditorsProvider/);
  });

  it("lets an editor register without a provider so it can be rendered alone in a test", () => {
    expect(() => renderHook(() => useBlockingEditor("theme", true))).not.toThrow();
  });
});
