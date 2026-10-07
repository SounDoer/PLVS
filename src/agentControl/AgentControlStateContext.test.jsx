/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { AgentControlStateProvider, useAgentControlState } from "./AgentControlStateContext.jsx";

function wrapper({ children }) {
  return <AgentControlStateProvider>{children}</AgentControlStateProvider>;
}

describe("AgentControlStateProvider", () => {
  it("starts from the boot descriptor and never asks for capabilities when unavailable", () => {
    const { result } = renderHook(() => useAgentControlState(), { wrapper });

    expect(result.current.runtime.available).not.toBe(true);
    expect(result.current.enabled).toBe(false);
    expect(result.current.platformCapabilities).toBeNull();
    expect(result.current.recordingState).toBeNull();
  });

  it("holds the enabled flag and the recording state the shell shows", () => {
    const { result } = renderHook(() => useAgentControlState(), { wrapper });

    act(() => result.current.setEnabled(true));
    act(() => result.current.setRecordingState("recording"));

    expect(result.current.enabled).toBe(true);
    expect(result.current.recordingState).toBe("recording");
  });

  it("refuses the hook outside the provider", () => {
    expect(() => renderHook(() => useAgentControlState())).toThrow(
      "useAgentControlState must be used inside AgentControlStateProvider"
    );
  });
});
