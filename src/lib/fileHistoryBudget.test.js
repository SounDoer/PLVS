import { expect, it } from "vitest";
import { estimateRetainedBytes, enforceFileHistoryBudget } from "./fileHistoryBudget.js";

it("counts shared backing storage once, including frozen/indexed views", () => {
  const buffer = new ArrayBuffer(1024);
  const view = new Float32Array(buffer);
  const one = estimateRetainedBytes([view]);
  expect(estimateRetainedBytes([view, view, buffer])).toBe(one);
  const cycle = { view, self: null };
  cycle.self = cycle;
  expect(estimateRetainedBytes([cycle])).toBeGreaterThan(1024);
});

function history() {
  const sessionsById = Object.fromEntries(
    ["old", "recent", "active", "task"].map((id, index) => {
      const intake = { data: new ArrayBuffer(1024) };
      const summary = { integratedLufs: -23 };
      return [
        id,
        {
          id,
          intake,
          summary,
          attempt: null,
          lastViewedAt: index,
          successfulResult: { intake, summary },
        },
      ];
    })
  );
  sessionsById.task.attempt = { intake: { data: new ArrayBuffer(1024) } };
  return {
    sessionsById,
    order: Object.keys(sessionsById),
    activeFileId: "active",
    analyzingFileId: "task",
  };
}

it("releases least recently viewed histories, retaining every statistic and protected intake", () => {
  const original = history();
  const budget = estimateRetainedBytes([
    original.sessionsById.active.intake,
    original.sessionsById.task.intake,
    original.sessionsById.task.attempt.intake,
    original.sessionsById.recent.intake,
  ]);
  const next = enforceFileHistoryBudget(original, budget);
  expect(next.order).toEqual(original.order);
  expect(next.sessionsById.old.intake).toBeNull();
  expect(next.sessionsById.old.successfulResult.intake).toBeNull();
  expect(next.sessionsById.old.summary).toBe(original.sessionsById.old.summary);
  expect(next.sessionsById.recent.intake).toBe(original.sessionsById.recent.intake);
  expect(original.sessionsById.old.intake).not.toBeNull();
});

it("allows protected histories to exceed the target and respects preparation protection", () => {
  const original = history();
  const next = enforceFileHistoryBudget(original, 0, "recent");
  expect(next.sessionsById.recent.intake).toBe(original.sessionsById.recent.intake);
  expect(next.sessionsById.active.intake).toBe(original.sessionsById.active.intake);
  expect(next.sessionsById.task.attempt.intake).toBe(original.sessionsById.task.attempt.intake);
  expect(enforceFileHistoryBudget(next, 0, "recent")).toBe(next);
});
