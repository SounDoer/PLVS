import { describe, expect, it } from "vitest";
import { fileImportTracks, planFileImport } from "./fileImportPlan.js";

const version = { canonicalPath: "C:/mix.wav", byteLength: 10, sha256: "abc" };
const track = (index) => ({ index, codec: "pcm_s24le", channels: 2 });
const probe = (index, sourceVersion = version) => ({
  path: "C:/mix.wav",
  sourceVersion,
  selectedTrack: track(index),
  audioTracks: [track(1), track(2)],
});
const entry = (id, index, summary) => ({
  id,
  metadata: { sourceVersion: version, selectedTrack: track(index) },
  state: summary ? "complete" : "error",
  summary: summary ? {} : null,
});

describe("planFileImport", () => {
  it("selects the unchanged file and track that already has a result", () => {
    expect(planFileImport([entry("a", 1, true)], probe(1))).toEqual({
      action: "select",
      sessionId: "a",
    });
  });

  it("reruns the unchanged file and track when it has no result yet", () => {
    expect(planFileImport([entry("a", 1, false)], probe(1))).toEqual({
      action: "rerun",
      sessionId: "a",
    });
  });

  it("analyzes another track or changed content as a new entry", () => {
    expect(planFileImport([entry("a", 1, true)], probe(2))).toEqual({
      action: "analyze",
      sessionId: null,
    });
    expect(planFileImport([entry("a", 1, true)], probe(1, { ...version, sha256: "def" }))).toEqual({
      action: "analyze",
      sessionId: null,
    });
  });
});

describe("fileImportTracks", () => {
  it("falls back to the selected track when no list was probed", () => {
    expect(fileImportTracks({ selectedTrack: track(3) })).toEqual([track(3)]);
    expect(fileImportTracks(probe(1))).toHaveLength(2);
  });
});
