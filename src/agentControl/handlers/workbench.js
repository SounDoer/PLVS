import { semanticFailure } from "../bridge/failures.js";
import { assertExpectedRevision } from "./shared.js";

/** Below the 25 s broker budget for `workbench.open`, so this command's own timeout wins. */
export const WORKBENCH_OPEN_TIMEOUT_MS = 20000;
const WORKBENCH_OPEN_POLL_MS = 250;

/** Tauri rejects with strings or plain objects as well as Errors. */
function failureMessage(error, fallback) {
  if (typeof error === "string" && error) return error;
  if (typeof error?.message === "string" && error.message) return error.message;
  if (error && typeof error === "object") {
    try {
      return JSON.stringify(error);
    } catch {
      return fallback;
    }
  }
  return fallback;
}

function requireWorkbench(ctx) {
  const workbenchControl = ctx.live().workbenchControl;
  if (!workbenchControl?.available) {
    throw semanticFailure(
      "controlUnavailable",
      "$.method",
      "Workbench lifecycle control is unavailable in this app.",
      -32012
    );
  }
  if (workbenchControl.busy) {
    throw semanticFailure(
      "busy",
      "$.method",
      "Workbenches cannot open or quit while an update is installing.",
      -32012
    );
  }
  return workbenchControl;
}

/** The Tray refuses to quit a workbench with an open editor and brings that editor forward. */
function refuseOpenEditors(ctx) {
  const editors = ctx.live().uiNavigation?.inspectUi?.()?.activeBlockingEditors ?? [];
  if (editors.length > 0) {
    throw semanticFailure(
      "editorActive",
      "$.method",
      "Close the open editor before quitting this workbench.",
      -32042,
      { editors }
    );
  }
}

/**
 * Quit Workbench: saves, retires this workbench from the restore set and exits, as the Tray's
 * Quit Workbench and the window's Quit do. With one workbench this quits PLVS. The response is
 * delivered before the process ends.
 *
 * @param {import("../bridge/types.js").BridgeContext} ctx
 */
async function quitWorkbench(ctx) {
  const revision = assertExpectedRevision(ctx, "The app", { required: true });
  const workbenchControl = requireWorkbench(ctx);
  refuseOpenEditors(ctx);
  return {
    requestId: ctx.requestId,
    result: { revision, accepted: true, scope: "workbench" },
    awaitDelivery: true,
    afterResponse: () => workbenchControl.quitWorkbench(),
  };
}

/**
 * Quit PLVS: every workbench stops, saves and exits, keeping the restore set, as the Tray's and
 * the macOS menu's Quit PLVS do. Every workbench is prepared before the response, so a refusal
 * anywhere fails the command and nothing quits.
 *
 * @param {import("../bridge/types.js").BridgeContext} ctx
 */
async function quitApp(ctx) {
  const revision = assertExpectedRevision(ctx, "The app", { required: true });
  const workbenchControl = requireWorkbench(ctx);
  refuseOpenEditors(ctx);
  let operation;
  try {
    operation = await workbenchControl.prepareQuitAll();
  } catch (error) {
    throw semanticFailure(
      "quitRefused",
      "$.method",
      failureMessage(error, "Another PLVS workbench refused to quit."),
      -32012
    );
  }
  return {
    requestId: ctx.requestId,
    result: { revision, accepted: true, scope: "all" },
    awaitDelivery: true,
    afterResponse: () =>
      workbenchControl.commitQuitAll(operation).catch((error) => {
        console.error("Agent Control Quit PLVS failed after it was accepted", error);
      }),
  };
}

/**
 * Opens one additional workbench as a second launch does and waits until it has registered.
 *
 * @param {import("../bridge/types.js").BridgeContext} ctx
 */
async function openWorkbench(ctx) {
  const revision = assertExpectedRevision(ctx, "The app", { required: true });
  const workbenchControl = requireWorkbench(ctx);
  const known = new Set(
    (await workbenchControl.listInstances()).map(({ instanceId }) => instanceId)
  );
  try {
    await workbenchControl.openWorkbench();
  } catch (error) {
    throw semanticFailure(
      "workbenchUnavailable",
      "$.method",
      failureMessage(error, "PLVS could not open another workbench."),
      -32012
    );
  }
  const deadline = Date.now() + WORKBENCH_OPEN_TIMEOUT_MS;
  for (;;) {
    const opened = (await workbenchControl.listInstances()).find(
      ({ instanceId }) => !known.has(instanceId)
    );
    if (opened) {
      return {
        requestId: ctx.requestId,
        result: {
          revision,
          instanceId: opened.instanceId,
          workspaceId: opened.workspaceId,
          displayName: opened.displayName,
        },
      };
    }
    if (Date.now() >= deadline) {
      throw semanticFailure(
        "timeout",
        "$.method",
        "The new workbench did not register in time.",
        -32042
      );
    }
    await new Promise((resolve) => setTimeout(resolve, WORKBENCH_OPEN_POLL_MS));
  }
}

/** @type {Record<string, import("../bridge/types.js").HandlerEntry>} */
export const workbenchHandlers = {
  // Both wait on other processes for longer than the serialized queue's backstop allows.
  "workbench.quitAll": { run: quitApp, lane: "direct" },
  "workbench.quit": { run: quitWorkbench },
  "workbench.open": { run: openWorkbench, lane: "direct" },
};
