import { describe, expect, it, vi } from "vitest";

import { createRevisionClock } from "../bridge/revisionClock.js";
import { createSettlementRegistry } from "../bridge/settlement.js";
import { DEFAULT_WORKSPACE_STATE } from "../../workspace/constants.js";
import { workspaceLayoutHandlers } from "./workspaceLayout.js";

function context(params, workspace) {
  const clock = createRevisionClock({ onWake: () => {} });
  const settlement = createSettlementRegistry(clock);
  const state = {
    workspace,
    resetWorkspace: vi.fn(() => {
      // The reducer's result, observed the way the bridge's Workspace watcher observes a commit.
      clock.bump();
      if (settlement.peek("workspace")?.matches({ ...DEFAULT_WORKSPACE_STATE })) {
        settlement.resolve("workspace");
      }
    }),
    waitForWorkspacePersistenceEnqueue: vi.fn(async () => {}),
  };
  return {
    state,
    ctx: /** @type {any} */ ({
      requestId: "request-1",
      request: { method: "workspace.reset", params },
      clock,
      settlement,
      flush: vi.fn(async () => {}),
      snap: state,
      live: () => state,
    }),
  };
}

describe("workspace reset", () => {
  const changedWorkspace = { ...DEFAULT_WORKSPACE_STATE, panelOrder: ["stats"] };

  it("previews without resetting", async () => {
    const { ctx, state } = context({ expectedRevision: 0, dryRun: true }, changedWorkspace);
    const response = await workspaceLayoutHandlers["workspace.reset"].run(ctx);

    expect(response.result).toMatchObject({ dryRun: true, changed: true });
    expect(state.resetWorkspace).not.toHaveBeenCalled();
  });

  it("runs the Panels menu's Reset Layout and waits for it to persist", async () => {
    const { ctx, state } = context({ expectedRevision: 0 }, changedWorkspace);
    const response = await workspaceLayoutHandlers["workspace.reset"].run(ctx);

    expect(state.resetWorkspace).toHaveBeenCalledOnce();
    expect(state.waitForWorkspacePersistenceEnqueue).toHaveBeenCalledWith(DEFAULT_WORKSPACE_STATE);
    expect(ctx.flush).toHaveBeenCalledOnce();
    expect(response.result).toMatchObject({ dryRun: false, changed: true, revision: 1 });
  });

  it("does nothing when the layout already uses the defaults", async () => {
    const { ctx, state } = context({ expectedRevision: 0 }, { ...DEFAULT_WORKSPACE_STATE });
    const response = await workspaceLayoutHandlers["workspace.reset"].run(ctx);

    expect(response.result.changed).toBe(false);
    expect(state.resetWorkspace).not.toHaveBeenCalled();
  });
});
