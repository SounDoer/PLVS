/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useFileSessionLedger } from "./useFileSessionLedger.js";
import { buildFileAnalysisReport } from "../lib/fileAnalysisReport.js";

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

  it("freezes request settings independently of later caller mutations", () => {
    const { result } = mount();
    const settings = { dialogue: { enabled: true, engine: "firered" } };
    act(() => result.current.beginRun("C:/a.wav", settings));
    settings.dialogue.engine = "silero";
    expect(result.current.validRunRequest.analysisSettings.dialogue.engine).toBe("firered");
  });

  it("markStopped retains partial progress and clears the run request", () => {
    const { result } = mount();
    let sessionId;
    act(() => {
      sessionId = result.current.beginRun("C:/mix/final.wav", {});
    });
    act(() => result.current.updateSession(sessionId, (entry) => ({ ...entry, progress: 0.625 })));
    act(() => result.current.markStopped(sessionId));

    expect(result.current.fileHistory.analyzingFileId).toBe(null);
    expect(result.current.validRunRequest).toBe(null);
    expect(result.current.fileHistory.sessionsById[sessionId].state).toBe("ready");
    expect(result.current.fileHistory.sessionsById[sessionId].progress).toBe(0.625);
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

  it.each(["cancel", "error"])(
    "retains successful data and export after replacement %s",
    (outcome) => {
      const { result } = mount();
      act(() =>
        result.current.beginRun("C:/a.wav", { dialogue: { enabled: true, engine: "firered" } })
      );
      const id = result.current.activeFileSession.id;
      const summary = { integratedLufs: -23, channels: 2, sampleRateHz: 48000 };
      act(() => {
        result.current.updateSession(id, (entry) => ({
          ...entry,
          state: "complete",
          summary,
          analyzedAt: 10,
        }));
        result.current.setAnalyzingFileId(null);
      });
      const oldIntake = result.current.activeFileSession.intake;
      act(() =>
        result.current.rerun(id, "C:/a.wav", { dialogue: { enabled: true, engine: "silero" } })
      );
      expect(result.current.activeFileSession.intake).toBe(oldIntake);
      expect(result.current.activeFileSession.attempt.intake).not.toBe(oldIntake);
      expect(
        buildFileAnalysisReport(result.current.activeFileSession).analysis.dialogue.engine
      ).toBe("firered");
      if (outcome === "cancel") {
        act(() => result.current.markStopped(id));
      } else {
        act(() =>
          result.current.updateSession(id, (entry) => ({
            ...entry,
            state: "error",
            error: "decode failed",
            analyzedAt: 20,
          }))
        );
      }
      expect(buildFileAnalysisReport(result.current.activeFileSession).summary.integratedLufs).toBe(
        -23
      );
      expect(buildFileAnalysisReport(result.current.activeFileSession).analysis.analyzedAt).toBe(
        new Date(10).toISOString()
      );
      expect(result.current.activeFileSession.intake).toBe(oldIntake);
    }
  );

  it("publishes replacement history, conditions and summary together only on success", () => {
    const { result } = mount();
    act(() => result.current.beginRun("C:/a.wav", { dialogue: { enabled: false } }));
    const id = result.current.activeFileSession.id;
    act(() => {
      result.current.updateSession(id, (entry) => ({
        ...entry,
        state: "complete",
        summary: { integratedLufs: -23 },
      }));
      result.current.setAnalyzingFileId(null);
    });
    const old = result.current.activeFileSession.successfulResult;
    const nextSettings = { dialogue: { enabled: true, engine: "silero" } };
    act(() => result.current.rerun(id, "C:/a.wav", nextSettings));
    const nextIntake = result.current.activeFileSession.attempt.intake;
    expect(result.current.activeFileSession.summary).toBe(old.summary);
    act(() =>
      result.current.updateSession(id, (entry) => ({
        ...entry,
        state: "complete",
        summary: { integratedLufs: -20 },
      }))
    );
    expect(result.current.activeFileSession.attempt).toBeNull();
    expect(result.current.activeFileSession.intake).toBe(nextIntake);
    expect(result.current.activeFileSession.analysisSettings).toEqual(nextSettings);
    expect(result.current.activeFileSession.successfulResult.summary.integratedLufs).toBe(-20);
  });
});
