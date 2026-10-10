import { describe, expect, it, vi } from "vitest";
import { createRevisionClock } from "./revisionClock.js";

/** @returns {Promise<void>} */
const turn = () => new Promise((resolve) => queueMicrotask(() => resolve()));

describe("createRevisionClock", () => {
  it("advances once for several bumps in one turn and again in the next", async () => {
    const clock = createRevisionClock({ onWake: () => {} });
    clock.bump();
    clock.bump();
    expect(clock.current()).toBe(1);
    await turn();
    clock.bump();
    expect(clock.current()).toBe(2);
  });

  it("advances once for a whole batch, however many turns it spans", async () => {
    const clock = createRevisionClock({ onWake: () => {} });
    const batch = clock.beginBatch();
    clock.bump();
    await turn();
    clock.bump();
    clock.bumpWorkspace();
    expect(clock.current()).toBe(1);
    expect(batch).toMatchObject({ startRevision: 0, bumped: true });
    clock.endBatch(batch);
    await turn();
    clock.bump();
    expect(clock.current()).toBe(2);
  });

  it("holds the wake until the batch ends", async () => {
    const onWake = vi.fn();
    const clock = createRevisionClock({ onWake });
    const batch = clock.beginBatch();
    clock.bump();
    clock.scheduleWake();
    await turn();
    expect(onWake).not.toHaveBeenCalled();
    clock.endBatch(batch);
    await turn();
    expect(onWake).toHaveBeenCalledExactlyOnceWith(1);
  });

  it("does not let a late finish clear a later command's batch", () => {
    const clock = createRevisionClock({ onWake: () => {} });
    const abandoned = clock.beginBatch();
    clock.abandonBatch();
    const later = clock.beginBatch();
    clock.endBatch(abandoned);
    expect(clock.activeBatch()).toBe(later);
  });

  it("publishes a pending wake when a batch is abandoned", async () => {
    const onWake = vi.fn();
    const clock = createRevisionClock({ onWake });
    clock.beginBatch();
    clock.bumpWorkspace();
    clock.abandonBatch();
    await turn();
    expect(onWake).toHaveBeenCalledExactlyOnceWith(1);
  });
});
