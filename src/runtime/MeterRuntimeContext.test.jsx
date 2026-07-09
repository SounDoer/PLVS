/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MeterRuntimeProvider, useMeterRuntime } from "./MeterRuntimeContext.jsx";

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

  it("clears the active Live source without stopping capture", async () => {
    const { result } = renderHook(() => useMeterRuntime(), { wrapper });

    act(() => result.current.startLive());
    await act(() => result.current.clearActiveSource());

    expect(result.current.running).toBe(true);
  });

  it("begins one file analysis and rejects a concurrent run", () => {
    const { result } = renderHook(() => useMeterRuntime(), { wrapper });
    const settings = { analysisRequests: { spectrum: [], vectorscope: [] } };

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

    act(() => result.current.beginFileAnalysis("C:\\first.wav", firstSettings));
    const sessionId = result.current.activeFileSession.id;
    await act(() => result.current.stopFileAnalysis());
    act(() => result.current.reanalyzeFile(sessionId, nextSettings));

    expect(result.current.fileSessions).toHaveLength(1);
    expect(result.current.analyzingFileId).toBe(sessionId);
  });

  it("selects a previous file result", async () => {
    const { result } = renderHook(() => useMeterRuntime(), { wrapper });

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
});
