import { describe, expect, it } from "vitest";
import { createLiveMeasurementOwner } from "./liveMeasurementOwner.js";

describe("liveMeasurementOwner", () => {
  it("publishes a coherent immutable record only when a new session succeeds", () => {
    let wallTime = 100;
    const owner = createLiveMeasurementOwner({ now: () => wallTime });
    owner.beginSession();
    owner.capture(
      { seq: 3, timestampMs: 40, loudnessLayout: "stereo", loudnessLayoutKnown: true },
      { peakDb: [-2], rmsDb: [-10], integrated: -20 },
      { dialogueActive: true }
    );
    expect(owner.read()).toEqual({ generation: 0, record: null });

    owner.commitSession();
    const snapshot = owner.read();
    expect(snapshot.generation).toBe(1);
    expect(snapshot.record).toMatchObject({
      generation: 1,
      sequence: 3,
      elapsedMs: 40,
      receivedAtMs: 100,
      loudnessLayout: "stereo",
      loudnessLayoutKnown: true,
      dialogueActive: true,
    });
    expect(Object.isFrozen(snapshot.record)).toBe(true);
    expect(Object.isFrozen(snapshot.record.audio.peakDb)).toBe(true);
  });

  it("retains the prior session after a failed restart", () => {
    const owner = createLiveMeasurementOwner();
    owner.beginSession();
    owner.capture({ seq: 1 }, { peakDb: [-1] });
    owner.commitSession();
    const before = owner.read();
    owner.beginSession();
    owner.capture({ seq: 2 }, { peakDb: [-2] });
    owner.abortSession();
    expect(owner.read()).toEqual(before);
  });

  it("retains the last record after stop and clears it with a new generation", () => {
    const owner = createLiveMeasurementOwner();
    owner.beginSession();
    owner.capture({ seq: 1 }, { peakDb: [-1] });
    owner.commitSession();
    expect(owner.read().record).not.toBeNull();
    owner.clear();
    expect(owner.read()).toEqual({ generation: 2, record: null });
    owner.capture({ seq: 2 }, { peakDb: [-2] });
    expect(owner.read().record.generation).toBe(2);
  });

  it("copies only bounded scalar measurement data", () => {
    const owner = createLiveMeasurementOwner();
    const peaks = [-1, -2];
    owner.capture(
      { seq: 1, spectrumResultsByKey: { huge: { smoothDb: new Array(1000).fill(0) } } },
      { peakDb: peaks, spectrumResultsByKey: { huge: {} } }
    );
    peaks[0] = -99;
    const audio = owner.read().record.audio;
    expect(audio.peakDb).toEqual([-1, -2]);
    expect(audio).not.toHaveProperty("spectrumResultsByKey");
    expect(audio).not.toHaveProperty("vectorscopeResultsByKey");
    expect(audio).not.toHaveProperty("stereoMapResultsByKey");
  });

  it("notifies subscribers only when public LIVE state changes", () => {
    const owner = createLiveMeasurementOwner();
    const observed = [];
    const unsubscribe = owner.subscribe((snapshot) => observed.push(snapshot));

    owner.beginSession();
    owner.capture({ seq: 1 }, { peakDb: [-1] });
    expect(observed).toEqual([]);

    owner.commitSession();
    owner.capture({ seq: 2 }, { peakDb: [-2] });
    owner.clear();
    unsubscribe();
    owner.capture({ seq: 3 }, { peakDb: [-3] });

    expect(
      observed.map(({ generation, record }) => [generation, record?.sequence ?? null])
    ).toEqual([
      [1, 1],
      [1, 2],
      [2, null],
    ]);
  });
});
