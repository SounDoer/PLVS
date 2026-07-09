/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { FrameIntake } from "../lib/FrameIntake.js";
import { useIntakeRouting } from "./useIntakeRouting.js";

const emptyHistory = { analyzingFileId: null, activeFileId: null };

function run(props) {
  return renderHook((p) => useIntakeRouting(p), { initialProps: props });
}

describe("useIntakeRouting", () => {
  it("routes intakeRef to the live intake in live mode", () => {
    const liveIntake = new FrameIntake();
    const { result } = run({
      sourceMode: "live",
      fileHistory: emptyHistory,
      activeFileSession: null,
      analyzingFileSession: null,
      liveIntake,
    });
    expect(result.current.intakeRef.current).toBe(liveIntake);
    expect(result.current.fileDisplayActiveRef.current).toBe(false);
  });

  it("routes intakeRef to the active file intake in file mode, falling back to an empty ring", () => {
    const liveIntake = new FrameIntake();
    const fileIntake = new FrameIntake();
    const props = {
      sourceMode: "file",
      fileHistory: { analyzingFileId: null, activeFileId: "a" },
      activeFileSession: { intake: fileIntake },
      analyzingFileSession: null,
      liveIntake,
    };
    const { result, rerender } = run(props);
    expect(result.current.intakeRef.current).toBe(fileIntake);
    expect(result.current.fileAnalysisIntake).not.toBe(fileIntake);

    rerender({ ...props, activeFileSession: null });
    expect(result.current.intakeRef.current).not.toBe(liveIntake);
    expect(result.current.intakeRef.current).toBe(result.current.fileDisplayIntake);
  });

  it("marks the file display active only when the analyzing session is also displayed", () => {
    const liveIntake = new FrameIntake();
    const base = {
      sourceMode: "file",
      activeFileSession: { intake: new FrameIntake() },
      analyzingFileSession: { intake: new FrameIntake() },
      liveIntake,
    };
    const { result, rerender } = run({
      ...base,
      fileHistory: { analyzingFileId: "a", activeFileId: "a" },
    });
    expect(result.current.fileDisplayActiveRef.current).toBe(true);

    rerender({ ...base, fileHistory: { analyzingFileId: "a", activeFileId: "b" } });
    expect(result.current.fileDisplayActiveRef.current).toBe(false);

    rerender({
      ...base,
      sourceMode: "live",
      fileHistory: { analyzingFileId: "a", activeFileId: "a" },
    });
    expect(result.current.fileDisplayActiveRef.current).toBe(false);
  });
});
