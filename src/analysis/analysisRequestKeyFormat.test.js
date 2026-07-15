import { describe, expect, it } from "vitest";
import {
  spectrumRequestKeyFromControls,
  vectorscopeRequestKeyFromControls,
} from "./analysisRequests.js";
import fixtures from "../../shared/analysis-request-key-fixtures.json";

// Parity guard: the JS deriver must produce exactly the request-key strings recorded in the
// shared fixture. The Rust validator (src-tauri/src/ipc/commands.rs) asserts the same fixture,
// so the key grammar cannot drift on one side without failing a test.
describe("analysis request key format (shared fixture)", () => {
  it.each(fixtures.spectrum)("spectrum %o derives its fixture key", (entry) => {
    const spectrumChannel =
      entry.type === "single"
        ? { type: "single", ch: entry.ch }
        : { type: "pair", x: entry.x, y: entry.y };
    const key = spectrumRequestKeyFromControls({
      spectrumChannel,
      spectrumView: entry.view,
      spectrumSpeedPercent: entry.speedPercent,
      spectrumTiltDbPerOctave: entry.tiltDbPerOctave,
      spectrumOctaveSmoothing: entry.octaveSmoothing,
    });
    expect(key).toBe(entry.key);
  });

  it.each(fixtures.vectorscope)("vectorscope %o derives its fixture key", (entry) => {
    const key = vectorscopeRequestKeyFromControls({ vectorscopePair: { x: entry.x, y: entry.y } });
    expect(key).toBe(entry.key);
  });
});
