/** @vitest-environment jsdom */
import { act, render, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  MeterRuntimeProvider,
  useMeterDisplayState,
  useMeterRuntime,
  useMeterRuntimeAssembly,
} from "./MeterRuntimeContext.jsx";

const native = vi.hoisted(() => ({ enabled: false, clear: vi.fn() }));
vi.mock("../ipc/env.js", async (original) => ({
  ...(await original()),
  isTauri: () => native.enabled,
}));

function wrapper({ children }) {
  return <MeterRuntimeProvider>{children}</MeterRuntimeProvider>;
}

describe("MeterRuntimeProvider", () => {
  it("owns the live lifecycle behind startLive and stopLive", () => {
    const { result } = renderHook(() => useMeterRuntime(), { wrapper });

    expect(result.current.sourceMode).toBe("live");
    expect(result.current.running).toBe(false);

    act(() => result.current.startLive());
    expect(result.current.running).toBe(true);

    act(() => result.current.stopLive());
    expect(result.current.running).toBe(false);
  });

  it("stops live capture when switching to File", () => {
    const { result } = renderHook(() => useMeterRuntime(), { wrapper });

    act(() => result.current.startLive());
    act(() => result.current.switchSource("file"));

    expect(result.current.sourceMode).toBe("file");
    expect(result.current.running).toBe(false);
  });

  it("refuses File analysis while Live is selected", () => {
    const { result } = renderHook(() => useMeterRuntime(), { wrapper });

    act(() => expect(result.current.beginFileAnalysis("/tmp/late.wav", {})).toBeNull());

    expect(result.current.fileTaskBusy).toBe(false);
  });

  it("clears the active Live source without stopping capture", async () => {
    const { result } = renderHook(() => useMeterRuntime(), { wrapper });

    act(() => result.current.startLive());
    await act(() => result.current.clearActiveSource());

    expect(result.current.running).toBe(true);
  });

  it("preserves Live history after a native Clear failure and clears it on retry", async () => {
    const { result } = renderHook(
      () => ({
        runtime: useMeterRuntime(),
        assembly: useMeterRuntimeAssembly(),
        display: useMeterDisplayState(),
      }),
      { wrapper }
    );
    const reset = vi.spyOn(result.current.assembly.liveIntakeRef.current, "reset");
    native.clear.mockRejectedValueOnce(new Error("native Clear failed"));
    native.clear.mockImplementationOnce(async (_kind, apply) => apply());
    native.enabled = true;
    act(() => result.current.runtime.startLive());
    act(() => {
      result.current.assembly.audioRef.current = {
        mode: "tauri",
        meter: { resetMeter: native.clear },
      };
      result.current.assembly.transport.markStarted();
    });
    try {
      await act(async () => expect(await result.current.runtime.clearActiveSource()).toBe(false));

      expect(reset).not.toHaveBeenCalled();
      expect(result.current.display.notice).toMatchObject({
        kind: "error",
        text: "Could not clear the Live measurement",
      });

      await act(async () => expect(await result.current.runtime.clearActiveSource()).toBe(true));

      expect(reset).toHaveBeenCalledOnce();
      expect(result.current.display.notice).toBeNull();
    } finally {
      native.enabled = false;
      native.clear.mockReset();
    }
  });

  it("preserves the TP Max on failure and resets only that value on confirmation", async () => {
    const { result } = renderHook(
      () => ({ runtime: useMeterRuntime(), assembly: useMeterRuntimeAssembly() }),
      { wrapper }
    );

    act(() => result.current.runtime.startLive());
    act(() => {
      result.current.assembly.audioRef.current = {
        mode: "tauri",
        meter: { resetMeter: native.clear },
      };
      result.current.assembly.transport.markStarted();
      result.current.assembly.display.setAudio({ tpMax: -1, mMax: -12, stMax: -16 });
    });
    native.clear.mockRejectedValueOnce(new Error("native reset failed"));
    try {
      await act(() =>
        expect(result.current.runtime.resetLiveTruePeakMax()).rejects.toThrow("native reset failed")
      );
      expect(result.current.assembly.display.audio.tpMax).toBe(-1);

      native.clear.mockImplementationOnce(async (_kind, apply) => apply());
      await act(() => result.current.runtime.resetLiveTruePeakMax());
      expect(result.current.assembly.display.audio).toMatchObject({
        tpMax: -Infinity,
        mMax: -12,
        stMax: -16,
      });
    } finally {
      native.clear.mockReset();
    }
  });

  it("does not clear File display data when an older Live reset completes", async () => {
    const { result } = renderHook(
      () => ({ runtime: useMeterRuntime(), assembly: useMeterRuntimeAssembly() }),
      { wrapper }
    );
    let publishReset;
    act(() => result.current.runtime.startLive());
    act(() => {
      result.current.assembly.audioRef.current = {
        mode: "tauri",
        meter: {
          resetMeter: (_kind, apply) =>
            new Promise((resolve, reject) => {
              publishReset = () => Promise.resolve().then(apply).then(resolve, reject);
            }),
        },
      };
      result.current.assembly.transport.markStarted();
    });

    let rejected;
    await act(async () => {
      rejected = result.current.runtime.resetLiveTruePeakMax().catch((error) => error);
      result.current.runtime.switchSource("file");
      result.current.assembly.display.setAudio({ tpMax: -5 });
    });
    await act(async () => {
      await publishReset();
      expect(await rejected).toBeInstanceOf(Error);
    });
    expect(result.current.assembly.display.audio.tpMax).toBe(-5);
  });

  it("can clear retained Live data while File remains selected", async () => {
    const { result } = renderHook(() => useMeterRuntime(), { wrapper });

    act(() => result.current.switchSource("file"));
    await act(() => result.current.clearLiveForControl());

    expect(result.current.sourceMode).toBe("file");
    expect(result.current.fileSessions).toHaveLength(0);
  });

  it("runs a Live clear owed by a File-time method change on the return to Live", async () => {
    const { result } = renderHook(
      () => ({ runtime: useMeterRuntime(), assembly: useMeterRuntimeAssembly() }),
      { wrapper }
    );
    const settings = { analysisRequests: { spectrum: [], vectorscope: [] } };
    const liveIntake = result.current.assembly.liveIntakeRef.current;
    const reset = vi.spyOn(liveIntake, "reset");

    act(() => result.current.runtime.switchSource("file"));
    act(() => result.current.runtime.beginFileAnalysis("C:\first.wav", settings));
    await act(() => result.current.runtime.stopFileAnalysis());
    act(() => result.current.runtime.deferLiveClear());
    expect(reset).not.toHaveBeenCalled();

    await act(async () => result.current.runtime.switchSource("live"));
    expect(reset).toHaveBeenCalledOnce();
    expect(result.current.runtime.fileSessions).toHaveLength(1);

    act(() => result.current.runtime.switchSource("file"));
    await act(async () => result.current.runtime.switchSource("live"));
    expect(reset).toHaveBeenCalledOnce();
  });

  it("begins one file analysis and rejects a concurrent run", () => {
    const { result } = renderHook(() => useMeterRuntime(), { wrapper });
    const settings = { analysisRequests: { spectrum: [], vectorscope: [] } };

    act(() => result.current.switchSource("file"));
    act(() => result.current.beginFileAnalysis("C:\\first.wav", settings));
    act(() => result.current.beginFileAnalysis("C:\\second.wav", settings));

    expect(result.current.fileSessions).toHaveLength(1);
    expect(result.current.activeFileSession.path).toBe("C:\\first.wav");
    expect(result.current.analyzingFileId).toBe(result.current.activeFileSession.id);
  });

  it("reanalyzes an existing file without creating another session", async () => {
    const { result } = renderHook(() => useMeterRuntime(), { wrapper });
    const firstSettings = { analysisRequests: { spectrum: [], vectorscope: [] } };
    const nextSettings = { analysisRequests: { spectrum: [{ key: "main" }], vectorscope: [] } };

    act(() => result.current.switchSource("file"));
    act(() => result.current.beginFileAnalysis("C:\\first.wav", firstSettings));
    const sessionId = result.current.activeFileSession.id;
    await act(() => result.current.stopFileAnalysis());
    await act(async () => {
      await result.current.reanalyzeFile(sessionId, nextSettings);
    });

    expect(result.current.fileSessions).toHaveLength(1);
    expect(result.current.analyzingFileId).toBe(sessionId);
  });

  it("reopens a canceled entry and displays the fresh run's timeline", async () => {
    const { result } = renderHook(
      () => ({ ...useMeterRuntime(), assembly: useMeterRuntimeAssembly() }),
      { wrapper }
    );
    act(() => result.current.switchSource("file"));
    const path = "C:/first.wav";
    act(() => result.current.beginFileAnalysis(path, {}));
    const first = result.current.activeFileSession;
    await act(() => result.current.stopFileAnalysis());
    expect(result.current.activeFileSession.state).toBe("canceled");

    act(() => result.current.beginFileAnalysis("C:/second.wav", {}));
    await act(() => result.current.stopFileAnalysis());
    act(() => result.current.assembly.display.setAudio({ peakDb: [-10, -20] }));
    act(() => result.current.beginFileAnalysis(path, {}, null, first.id));

    expect(result.current.fileSessions).toHaveLength(2);
    expect(result.current.analyzingFileId).toBe(first.id);
    expect(result.current.activeFileSession).toMatchObject({
      id: first.id,
      state: "analyzing",
      progress: 0,
    });
    const { routing, display } = result.current.assembly;
    expect(display.audio.peakDb).toEqual([]);
    expect(routing.fileAnalysisIntake).not.toBe(first.attempt.intake);
    expect(routing.intakeRef.current).toBe(routing.fileAnalysisIntake);

    await act(() => result.current.stopFileAnalysis());
    expect(result.current.assembly.routing.intakeRef.current).toBe(routing.fileAnalysisIntake);
  });

  it("selects a previous file result", async () => {
    const { result } = renderHook(() => useMeterRuntime(), { wrapper });

    act(() => result.current.switchSource("file"));
    act(() => result.current.beginFileAnalysis("C:\\first.wav", {}));
    const firstId = result.current.activeFileSession.id;
    await act(() => result.current.stopFileAnalysis());
    act(() => result.current.beginFileAnalysis("C:\\second.wav", {}));
    await act(() => result.current.stopFileAnalysis());
    act(() => result.current.selectFile(firstId));

    expect(result.current.activeFileSession.id).toBe(firstId);
  });

  it("stops and removes an analyzing file", async () => {
    const { result } = renderHook(() => useMeterRuntime(), { wrapper });

    act(() => result.current.switchSource("file"));
    act(() => result.current.beginFileAnalysis("C:\\first.wav", {}));
    const sessionId = result.current.activeFileSession.id;
    await act(() => result.current.removeFile(sessionId));

    expect(result.current.fileSessions).toHaveLength(0);
    expect(result.current.analyzingFileId).toBeNull();
  });

  it("clears every file session", async () => {
    const { result } = renderHook(() => useMeterRuntime(), { wrapper });

    act(() => result.current.beginFileAnalysis("C:\\first.wav", {}));
    await act(() => result.current.stopFileAnalysis());
    act(() => result.current.beginFileAnalysis("C:\\second.wav", {}));
    await act(() => result.current.clearFiles());

    expect(result.current.fileSessions).toHaveLength(0);
    expect(result.current.activeFileSession).toBeNull();
  });

  it("keeps low-rate display consumers still while meter frames arrive", () => {
    let probeRenders = 0;
    /** @type {ReturnType<typeof useMeterRuntimeAssembly>} */
    let assembly;
    /** @type {ReturnType<typeof useMeterDisplayState>} */
    let displayState;
    function Probe() {
      displayState = useMeterDisplayState();
      probeRenders += 1;
      return null;
    }
    function Driver() {
      assembly = useMeterRuntimeAssembly();
      return null;
    }
    render(
      <MeterRuntimeProvider>
        <Probe />
        <Driver />
      </MeterRuntimeProvider>
    );

    const rendersBeforeFrame = probeRenders;
    act(() => assembly.display.setAudio((current) => ({ ...current, tpMax: -3 })));
    expect(probeRenders).toBe(rendersBeforeFrame);

    act(() => displayState.raiseNotice("error", "Boom"));
    expect(probeRenders).toBe(rendersBeforeFrame + 1);
    expect(displayState.notice).toMatchObject({ kind: "error", text: "Boom" });
  });

  it("refuses the low-rate display hook outside the provider", () => {
    expect(() => renderHook(() => useMeterDisplayState())).toThrow(
      "useMeterDisplayState must be used inside MeterRuntimeProvider"
    );
  });

  it("reserves the File task before another action can use a stale render", () => {
    const { result } = renderHook(() => useMeterRuntime(), { wrapper });
    act(() => result.current.switchSource("file"));
    act(() => {
      result.current.beginFileAnalysis("C:/a.wav", {});
      result.current.beginFileAnalysis("C:/b.wav", {});
    });
    expect(result.current.fileSessions).toHaveLength(1);
    expect(result.current.activeFileSession.path).toBe("C:/a.wav");
  });

  it("keeps a task reserved when native stop fails", async () => {
    const { result } = renderHook(
      () => ({ runtime: useMeterRuntime(), assembly: useMeterRuntimeAssembly() }),
      { wrapper }
    );
    act(() => result.current.runtime.switchSource("file"));
    act(() => result.current.runtime.beginFileAnalysis("C:/a.wav", {}));
    const id = result.current.runtime.activeFileId;
    result.current.assembly.stopFileAnalysisRef.current = async () => {
      throw new Error("stop failed");
    };
    await act(async () => {
      await expect(result.current.runtime.stopFileAnalysis()).rejects.toThrow("stop failed");
    });
    act(() => result.current.runtime.beginFileAnalysis("C:/b.wav", {}));
    expect(result.current.runtime.analyzingFileId).toBe(id);
    expect(result.current.runtime.fileSessions).toHaveLength(1);
  });

  it("keeps the transport reserved until a pending stop settles after completion", async () => {
    const { result } = renderHook(
      () => ({ runtime: useMeterRuntime(), assembly: useMeterRuntimeAssembly() }),
      { wrapper }
    );
    act(() => result.current.runtime.switchSource("file"));
    act(() => result.current.runtime.beginFileAnalysis("C:/a.wav", {}));
    const id = result.current.runtime.activeFileId;
    let finishStop;
    const nativeStop = vi.fn(
      () =>
        new Promise((resolve) => {
          finishStop = () => resolve(false);
        })
    );
    result.current.assembly.stopFileAnalysisRef.current = nativeStop;

    let firstStop;
    let repeatedStop;
    act(() => {
      firstStop = result.current.runtime.stopFileAnalysis(id);
      repeatedStop = result.current.runtime.stopFileAnalysis(id);
      result.current.assembly.ledger.updateSession(id, (entry) => ({
        ...entry,
        state: "complete",
        progress: 1,
      }));
      result.current.assembly.ledger.setAnalyzingFileId(null);
    });
    expect(nativeStop).toHaveBeenCalledExactlyOnceWith(id);
    expect(result.current.runtime.fileTaskBusy).toBe(true);
    act(() => {
      expect(result.current.runtime.beginFileAnalysis("C:/b.wav", {})).toBeNull();
    });

    await act(async () => {
      finishStop();
      await Promise.all([firstStop, repeatedStop]);
    });
    expect(result.current.runtime.fileTaskBusy).toBe(false);
    expect(result.current.runtime.activeFileSession.state).toBe("complete");
    act(() => {
      expect(result.current.runtime.beginFileAnalysis("C:/b.wav", {})).toBeTruthy();
    });
  });
  it.each(["removeFile", "clearFiles"])(
    "preserves the Live snapshot and clock during %s",
    async (method) => {
      const { result } = renderHook(
        () => ({
          runtime: useMeterRuntime(),
          display: useMeterDisplayState(),
        }),
        { wrapper }
      );
      act(() => result.current.runtime.switchSource("file"));
      act(() => result.current.runtime.beginFileAnalysis("old.wav", {}));
      const id = result.current.runtime.activeFileId;
      await act(() => result.current.runtime.stopFileAnalysis());
      act(() => result.current.runtime.switchSource("live"));
      act(() => result.current.runtime.startLive());
      act(() => result.current.display.selectSnapshot(0));
      expect(result.current.display).toMatchObject({ selectedOffset: 0, showClock: true });

      await act(() =>
        method === "removeFile"
          ? result.current.runtime.removeFile(id)
          : result.current.runtime.clearFiles()
      );
      expect(result.current.runtime.fileSessions).toHaveLength(0);
      expect(result.current.runtime.running).toBe(true);
      expect(result.current.display).toMatchObject({ selectedOffset: 0, showClock: true });
    }
  );
});
