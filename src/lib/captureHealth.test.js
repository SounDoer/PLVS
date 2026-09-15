import { describe, expect, it } from "vitest";
import { automaticOutputChangeNotice, describeAudioDrop } from "./captureHealth.js";

const runningAutomatic = { captureDeviceId: "default", sourceMode: "live", running: true };

describe("automaticOutputChangeNotice", () => {
  it("announces the restart when a running Automatic capture follows a new default output", () => {
    const notice = automaticOutputChangeNotice({
      ...runningAutomatic,
      previousLabel: "Speakers (Apogee Symphony Desktop)",
      nextLabel: "CABLE Input (VB-Audio Virtual Cable)",
    });
    expect(notice.text).toBe("Output changed — measurement restarted");
    expect(notice.details).toMatch(/^Now measuring .*CABLE.*VB-Audio Virtual Cable/);
  });

  it("stays quiet when nothing a running Automatic capture depends on changed", () => {
    const change = { previousLabel: "Speakers", nextLabel: "Headphones" };
    expect(automaticOutputChangeNotice({ ...runningAutomatic, ...change, previousLabel: "" })).toBe(
      null
    );
    expect(
      automaticOutputChangeNotice({ ...runningAutomatic, ...change, nextLabel: "Speakers" })
    ).toBe(null);
    expect(
      automaticOutputChangeNotice({ ...runningAutomatic, ...change, captureDeviceId: "lb-1" })
    ).toBe(null);
    expect(
      automaticOutputChangeNotice({ ...runningAutomatic, ...change, sourceMode: "file" })
    ).toBe(null);
    expect(automaticOutputChangeNotice({ ...runningAutomatic, ...change, running: false })).toBe(
      null
    );
  });
});

describe("describeAudioDrop", () => {
  it("names the amount, the start, the consequence and the way out", () => {
    const text = describeAudioDrop({ chunks: 5, since: Date.UTC(2026, 8, 15, 4, 45, 9) });
    expect(text).toMatch(
      /^5 audio chunks dropped before analysis since .+\. Integrated, LRA and max readings may be affected\. Clear to reset\.$/
    );
    expect(describeAudioDrop({ chunks: 1, since: 0 })).toMatch(/^1 audio chunk dropped/);
  });
});
