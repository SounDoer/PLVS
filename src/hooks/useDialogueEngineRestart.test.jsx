/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useRef } from "react";

import { useDialogueEngineRestart } from "./useDialogueEngineRestart.js";

describe("useDialogueEngineRestart", () => {
  it("clears when the engine changes while gating is on", () => {
    const clearAll = vi.fn();
    const { rerender } = renderHook(
      ({ engine, gating }) => {
        const ref = useRef(clearAll);
        ref.current = clearAll;
        useDialogueEngineRestart(engine, gating, ref);
      },
      { initialProps: { engine: "webrtc", gating: true } }
    );
    expect(clearAll).not.toHaveBeenCalled();

    rerender({ engine: "silero", gating: true });
    expect(clearAll).toHaveBeenCalledTimes(1);
  });

  it("does not clear when the engine changes while gating is off", () => {
    const clearAll = vi.fn();
    const { rerender } = renderHook(
      ({ engine, gating }) => {
        const ref = useRef(clearAll);
        ref.current = clearAll;
        useDialogueEngineRestart(engine, gating, ref);
      },
      { initialProps: { engine: "webrtc", gating: false } }
    );

    rerender({ engine: "silero", gating: false });
    expect(clearAll).not.toHaveBeenCalled();
  });

  it("does not clear on mount, and not on a re-render with an unchanged engine", () => {
    const clearAll = vi.fn();
    const { rerender } = renderHook(
      ({ engine, gating }) => {
        const ref = useRef(clearAll);
        ref.current = clearAll;
        useDialogueEngineRestart(engine, gating, ref);
      },
      { initialProps: { engine: "webrtc", gating: true } }
    );
    expect(clearAll).not.toHaveBeenCalled();

    // Re-render with the same engine value (e.g. an unrelated prop changing elsewhere in App).
    rerender({ engine: "webrtc", gating: true });
    expect(clearAll).not.toHaveBeenCalled();
  });
});
