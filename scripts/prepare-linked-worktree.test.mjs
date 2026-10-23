import { describe, expect, it, vi } from "vitest";
import { prepareLinkedWorktree } from "./prepare-linked-worktree.mjs";

describe("linked worktree preparation", () => {
  it("leaves the primary checkout alone", async () => {
    const ensure = vi.fn();
    const log = { log: vi.fn() };

    await expect(prepareLinkedWorktree({ worktree: null, ensure, log })).resolves.toEqual({
      prepared: false,
      worktree: null,
    });

    expect(ensure).not.toHaveBeenCalled();
  });

  it("restores verified sidecars in a linked worktree", async () => {
    const ensure = vi.fn().mockResolvedValue(undefined);
    const log = { log: vi.fn() };

    await expect(
      prepareLinkedWorktree({ worktree: "C:\\repo\\.codex\\worktrees\\feature", ensure, log })
    ).resolves.toEqual({
      prepared: true,
      worktree: "C:\\repo\\.codex\\worktrees\\feature",
    });

    expect(ensure).toHaveBeenCalledOnce();
  });

  it("fails the install when sidecars cannot be prepared", async () => {
    const failure = new Error("cache and network unavailable");

    await expect(
      prepareLinkedWorktree({
        worktree: "/repo/.codex/worktrees/feature",
        ensure: vi.fn().mockRejectedValue(failure),
        log: { log: vi.fn() },
      })
    ).rejects.toBe(failure);
  });
});
