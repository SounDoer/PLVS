/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useRef } from "react";

import { useChannelRolesRestart, useDialogueEngineRestart } from "./useDialogueEngineRestart.js";

describe("useDialogueEngineRestart", () => {
  it("clears when the engine changes while gating is on", () => {
    const clearAll = vi.fn();
    const deferLiveClear = vi.fn();
    const { rerender } = renderHook(
      ({ engine, gating }) => {
        const ref = useRef(clearAll);
        ref.current = clearAll;
        useDialogueEngineRestart(engine, gating, true, ref, deferLiveClear);
      },
      { initialProps: { engine: "webrtc", gating: true } }
    );
    expect(clearAll).not.toHaveBeenCalled();

    rerender({ engine: "silero", gating: true });
    expect(clearAll).toHaveBeenCalledTimes(1);
  });

  it("does not clear when the engine changes while gating is off", () => {
    const clearAll = vi.fn();
    const deferLiveClear = vi.fn();
    const { rerender } = renderHook(
      ({ engine, gating }) => {
        const ref = useRef(clearAll);
        ref.current = clearAll;
        useDialogueEngineRestart(engine, gating, true, ref, deferLiveClear);
      },
      { initialProps: { engine: "webrtc", gating: false } }
    );

    rerender({ engine: "silero", gating: false });
    expect(clearAll).not.toHaveBeenCalled();
  });

  it("does not clear on mount, and not on a re-render with an unchanged engine", () => {
    const clearAll = vi.fn();
    const deferLiveClear = vi.fn();
    const { rerender } = renderHook(
      ({ engine, gating }) => {
        const ref = useRef(clearAll);
        ref.current = clearAll;
        useDialogueEngineRestart(engine, gating, true, ref, deferLiveClear);
      },
      { initialProps: { engine: "webrtc", gating: true } }
    );
    expect(clearAll).not.toHaveBeenCalled();

    // Re-render with the same engine value (e.g. an unrelated prop changing elsewhere in App).
    rerender({ engine: "webrtc", gating: true });
    expect(clearAll).not.toHaveBeenCalled();
  });

  it("does not clear when gating turns on after an engine change, because Rust already reset itself", () => {
    // src-tauri/src/dsp/loudness.rs resets the dialogue accumulator itself the next time it sees
    // an engine mismatch while gating is on, so a frontend clear here would be redundant.
    const clearAll = vi.fn();
    const deferLiveClear = vi.fn();
    const { rerender } = renderHook(
      ({ engine, gating }) => {
        const ref = useRef(clearAll);
        ref.current = clearAll;
        useDialogueEngineRestart(engine, gating, true, ref, deferLiveClear);
      },
      { initialProps: { engine: "webrtc", gating: false } }
    );

    rerender({ engine: "silero", gating: false });
    rerender({ engine: "silero", gating: true });
    expect(clearAll).not.toHaveBeenCalled();
  });
});

describe("useDialogueEngineRestart while File is shown", () => {
  it("owes Live a clear instead of clearing the File", () => {
    const clearAll = vi.fn();
    const deferLiveClear = vi.fn();
    const { rerender } = renderHook(
      ({ engine }) => {
        const ref = useRef(clearAll);
        ref.current = clearAll;
        useDialogueEngineRestart(engine, true, false, ref, deferLiveClear);
      },
      { initialProps: { engine: "webrtc" } }
    );

    rerender({ engine: "silero" });
    expect(clearAll).not.toHaveBeenCalled();
    expect(deferLiveClear).toHaveBeenCalledOnce();
  });
});

describe("useChannelRolesRestart", () => {
  it("clears a Live measurement when the effective role list changes", () => {
    const clearAll = vi.fn();
    const deferLiveClear = vi.fn();
    const { rerender } = renderHook(
      ({ roles, live }) => {
        const ref = useRef(clearAll);
        ref.current = clearAll;
        useChannelRolesRestart(roles, live, ref, deferLiveClear);
      },
      { initialProps: { roles: {}, live: true } }
    );

    rerender({ roles: { 6: ["L", "R", "C", "LFE", "Ls", "Rs"] }, live: true });
    expect(clearAll).toHaveBeenCalledOnce();
  });

  it("leaves the File alone and owes Live a clear when roles change while File is shown", () => {
    const clearAll = vi.fn();
    const deferLiveClear = vi.fn();
    const { rerender } = renderHook(
      ({ roles, live }) => {
        const ref = useRef(clearAll);
        ref.current = clearAll;
        useChannelRolesRestart(roles, live, ref, deferLiveClear);
      },
      { initialProps: { roles: { 2: ["L", "R"] }, live: false } }
    );

    rerender({ roles: { 2: ["M", "M"] }, live: false });
    expect(clearAll).not.toHaveBeenCalled();
    expect(deferLiveClear).toHaveBeenCalledOnce();
  });
});
