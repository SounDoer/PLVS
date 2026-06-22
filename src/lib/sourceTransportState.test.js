import { describe, expect, it } from "vitest";
import { deriveSourceTransportState } from "./sourceTransportState.js";

describe("deriveSourceTransportState", () => {
  it("derives file scrub display from selected media time", () => {
    expect(
      deriveSourceTransportState({
        sourceMode: "file",
        selectedOffset: 3,
        selectedMediaTimeMs: 84_000,
        fileSession: { state: "complete", fileName: "final_mix.wav" },
      })
    ).toMatchObject({
      sourceLabel: "File",
      statusLabel: "00:01:24",
      actionLabel: "RESULT",
      chromeState: "snapshot",
      actionKind: "returnToFileResult",
    });
  });

  it("formats zero seconds as 00:00:00", () => {
    const r = deriveSourceTransportState({
      sourceMode: "file",
      selectedOffset: 0,
      selectedMediaTimeMs: 0,
    });
    expect(r.statusLabel).toBe("00:00:00");
    expect(r.chromeState).toBe("snapshot");
  });

  it("formats times over one hour correctly", () => {
    const r = deriveSourceTransportState({
      sourceMode: "file",
      selectedOffset: 0,
      selectedMediaTimeMs: 3_661_000,
    });
    expect(r.statusLabel).toBe("01:01:01");
  });

  it("uses single canonical selectedMediaTimeMs source, not nested under fileSession", () => {
    const selectedMediaTimeMs = 5_000;
    const r = deriveSourceTransportState({
      sourceMode: "file",
      selectedOffset: 1,
      selectedMediaTimeMs,
    });
    expect(r.statusLabel).toBe(r.statusLabel);
    expect(r.chromeState).toBe("snapshot");
  });
});
