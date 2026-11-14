import { describe, expect, it, vi } from "vitest";

import { createRevisionClock } from "../bridge/revisionClock.js";
import { WORKBENCH_OPEN_TIMEOUT_MS, workbenchHandlers } from "./workbench.js";

function context(method, workbenchControl, { editors = [], expectedRevision = 0 } = {}) {
  const state = {
    workbenchControl: { available: true, busy: false, ...workbenchControl },
    uiNavigation: { inspectUi: () => ({ activeBlockingEditors: editors }) },
  };
  return /** @type {any} */ ({
    requestId: "request-1",
    request: { method, params: { expectedRevision } },
    clock: createRevisionClock({ onWake: () => {} }),
    snap: state,
    live: () => state,
  });
}

describe("workbench lifecycle commands", () => {
  it("accepts Quit Workbench and quits only after the response is delivered", async () => {
    const quitWorkbench = vi.fn();
    const response = await workbenchHandlers["workbench.quit"].run(
      context("workbench.quit", { quitWorkbench })
    );
    expect(response.result).toEqual({ revision: 0, accepted: true, scope: "workbench" });
    expect(response.awaitDelivery).toBe(true);
    expect(quitWorkbench).not.toHaveBeenCalled();
    await response.afterResponse();
    expect(quitWorkbench).toHaveBeenCalledOnce();
  });

  it("prepares every workbench before accepting Quit PLVS and commits after delivery", async () => {
    const operation = { id: "op-1" };
    const prepareQuitAll = vi.fn(async () => operation);
    const commitQuitAll = vi.fn(async () => {});
    const response = await workbenchHandlers["workbench.quitAll"].run(
      context("workbench.quitAll", { prepareQuitAll, commitQuitAll })
    );
    expect(prepareQuitAll).toHaveBeenCalledOnce();
    expect(response.result).toEqual({ revision: 0, accepted: true, scope: "all" });
    expect(commitQuitAll).not.toHaveBeenCalled();
    await response.afterResponse();
    expect(commitQuitAll).toHaveBeenCalledWith(operation);
  });

  it("reports a peer's refusal of Quit PLVS before anything quits", async () => {
    const commitQuitAll = vi.fn();
    await expect(
      workbenchHandlers["workbench.quitAll"].run(
        context("workbench.quitAll", {
          prepareQuitAll: async () => {
            throw new Error("Another PLVS workbench has an open editor: theme");
          },
          commitQuitAll,
        })
      )
    ).rejects.toMatchObject({ reason: "quitRefused", message: expect.stringContaining("theme") });
    expect(commitQuitAll).not.toHaveBeenCalled();
  });

  it("refuses to quit with an open editor, while an update installs, or on a stale revision", async () => {
    const quitWorkbench = vi.fn();
    await expect(
      workbenchHandlers["workbench.quit"].run(
        context("workbench.quit", { quitWorkbench }, { editors: ["theme"] })
      )
    ).rejects.toMatchObject({ reason: "editorActive", details: { editors: ["theme"] } });
    await expect(
      workbenchHandlers["workbench.quit"].run(
        context("workbench.quit", { quitWorkbench, busy: true })
      )
    ).rejects.toMatchObject({ reason: "busy" });
    await expect(
      workbenchHandlers["workbench.quit"].run(
        context("workbench.quit", { quitWorkbench }, { expectedRevision: 5 })
      )
    ).rejects.toMatchObject({ reason: "revisionConflict" });
    expect(quitWorkbench).not.toHaveBeenCalled();
  });

  it("opens a workbench and returns the instance that registered after the request", async () => {
    const instances = [{ instanceId: "a", workspaceId: "default", displayName: "Output" }];
    const openWorkbench = vi.fn(async () => {
      instances.push({ instanceId: "b", workspaceId: "workspace-2", displayName: "Output (2)" });
    });
    const response = await workbenchHandlers["workbench.open"].run(
      context("workbench.open", { listInstances: async () => [...instances], openWorkbench })
    );
    expect(response.result).toEqual({
      revision: 0,
      instanceId: "b",
      workspaceId: "workspace-2",
      displayName: "Output (2)",
    });
  });

  it("times out when no new workbench registers", async () => {
    vi.useFakeTimers();
    const pending = workbenchHandlers["workbench.open"].run(
      context("workbench.open", {
        listInstances: async () => [{ instanceId: "a" }],
        openWorkbench: async () => {},
      })
    );
    const assertion = expect(pending).rejects.toMatchObject({ reason: "timeout" });
    await vi.advanceTimersByTimeAsync(WORKBENCH_OPEN_TIMEOUT_MS + 500);
    await assertion;
    vi.useRealTimers();
  });
});
