/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useFileSessionLedger } from "./useFileSessionLedger.js";

function mount() {
  return renderHook(() => useFileSessionLedger());
}

describe("useFileSessionLedger", () => {
  it("beginRun mints a session, marks it analyzing, and issues a valid run request", () => {
    const { result } = mount();
    let sessionId;
    act(() => {
      sessionId = result.current.beginRun("C:/mix/final.wav", { dialogue: false });
    });

    expect(result.current.fileHistory.analyzingFileId).toBe(sessionId);
    expect(result.current.fileSessions).toHaveLength(1);
    expect(result.current.analyzingFileSession?.id).toBe(sessionId);
    expect(result.current.validRunRequest).toMatchObject({
      sessionId,
      filePath: "C:/mix/final.wav",
      runId: 1,
    });
  });

  it("markStopped returns the entry to ready and clears the run request", () => {
    const { result } = mount();
    let sessionId;
    act(() => {
      sessionId = result.current.beginRun("C:/mix/final.wav", {});
    });
    act(() => result.current.markStopped(sessionId));

    expect(result.current.fileHistory.analyzingFileId).toBe(null);
    expect(result.current.validRunRequest).toBe(null);
    expect(result.current.fileHistory.sessionsById[sessionId].state).toBe("ready");
  });

  it("rerun bumps the run id and re-marks an existing entry", () => {
    const { result } = mount();
    let sessionId;
    act(() => {
      sessionId = result.current.beginRun("C:/a.wav", {});
    });
    act(() => result.current.markStopped(sessionId));
    act(() => result.current.rerun(sessionId, "C:/a.wav", { dialogue: true }));

    expect(result.current.fileHistory.analyzingFileId).toBe(sessionId);
    expect(result.current.validRunRequest?.runId).toBe(2);
  });

  it("a run request goes stale when its session stops being the analyzing one", () => {
    const { result } = mount();
    act(() => {
      result.current.beginRun("C:/a.wav", {});
    });
    act(() => result.current.setAnalyzingFileId(null));
    expect(result.current.validRunRequest).toBe(null);
  });

  it("select, remove and clearAll manage the ledger", () => {
    const { result } = mount();
    let a, b;
    act(() => {
      a = result.current.beginRun("C:/a.wav", {});
    });
    act(() => result.current.markStopped(a));
    act(() => {
      b = result.current.beginRun("C:/b.wav", {});
    });
    act(() => result.current.markStopped(b));

    act(() => result.current.select(a));
    expect(result.current.activeFileSession?.id).toBe(a);

    act(() => result.current.remove(a));
    expect(result.current.fileHistory.sessionsById[a]).toBeUndefined();

    act(() => result.current.clearAll());
    expect(result.current.fileSessions).toHaveLength(0);
    expect(result.current.validRunRequest).toBe(null);
  });
});
