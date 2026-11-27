import { semanticFailure } from "../bridge/failures.js";
import { assertExpectedRevision } from "./shared.js";
import {
  findPresentedTrayChoice,
  trayNavigationFor,
  TRAY_WORKBENCH_LABEL,
} from "../../tray/trayWorkbenchProtocol.js";

function unavailable(message) {
  return semanticFailure("controlUnavailable", "$.method", message, -32012);
}

function missingItem(message) {
  return semanticFailure("targetUnavailable", "$.params.item", message, -32042);
}

function publicTrayState({ rendered: _rendered, ...state }, tray, revision) {
  return { ...state, revision, presentation: tray.customPanel ? "panel" : "native" };
}

async function read(tray, refresh = false) {
  if (!tray?.owner) throw unavailable("Select the Workbench that owns the Tray.");
  const state = await tray.read({ refresh });
  if (!state) throw unavailable("The Tray has not finished starting.");
  return state;
}

async function inspect({ requestId, live, clock }) {
  const tray = live().trayControl;
  return { requestId, result: publicTrayState(await read(tray, true), tray, clock.current()) };
}

function checkGeneration(ctx, state) {
  assertExpectedRevision(ctx, "The app", { required: true });
  const { expectedUiGeneration } = ctx.request.params;
  if (state.uiGeneration !== expectedUiGeneration) {
    throw semanticFailure(
      "uiGenerationConflict",
      "$.params.expectedUiGeneration",
      "The Tray changed. Run tray inspect again.",
      -32042,
      { expectedUiGeneration, currentUiGeneration: state.uiGeneration }
    );
  }
}

async function waitForPresentation(tray, presentation, navigation, signal) {
  const deadline = Date.now() + 3000;
  while (presentation !== null && Date.now() < deadline && !signal?.aborted) {
    const state = await read(tray);
    if (
      state.rendered?.presentation === presentation &&
      state.navigation.branchKey === navigation.branchKey &&
      state.navigation.pickerKey === navigation.pickerKey &&
      (state.navigation.groupKeys ?? []).join() === (navigation.groupKeys ?? []).join()
    )
      return state;
    await new Promise((resolve) => setTimeout(resolve, 32));
  }
  throw semanticFailure("uiNotSettled", "$.method", "The Tray panel did not open in time.", -32042);
}

async function navigate(ctx) {
  const { request, requestId, live, clock, signal } = ctx;
  const tray = live().trayControl;
  if (tray?.owner && !tray.customPanel) {
    throw unavailable("The desktop Tray host controls this native menu.");
  }
  let state = await read(tray, true);
  checkGeneration(ctx, state);
  const { item } = request.params;
  if (request.method === "tray.open") {
    const navigation = item === undefined ? {} : trayNavigationFor(state.items, item);
    if (!navigation)
      throw missingItem("Choose an enabled Workbench branch, picker, or Source group.");
    let presentation;
    try {
      presentation = await tray.open(navigation);
    } catch (error) {
      throw unavailable(String(error));
    }
    state = await waitForPresentation(tray, presentation, navigation, signal);
  } else if (request.method === "tray.close") {
    if (state.visible) await tray.close();
    state = await read(tray);
  } else {
    if (item === "app:quit" || /^workbench:[^:]+:quit$/.test(item)) {
      throw missingItem("Use Workbench Control for quit operations.");
    }
    try {
      await tray.activate(item, async () => {
        const current = await read(tray, true);
        checkGeneration(ctx, current);
        if (
          !current.rendered ||
          !findPresentedTrayChoice(current.items, current.navigation, item)
        ) {
          throw missingItem("Open the item's Workbench or picker and choose an enabled action.");
        }
      });
    } catch (error) {
      if (error?.reason) throw error;
      throw semanticFailure(
        "commandFailed",
        "$.params.item",
        error?.message ?? String(error),
        -32603
      );
    }
    state = await read(tray);
  }
  return { requestId, result: publicTrayState(state, tray, clock.current()) };
}

/** @type {Record<string, import("../bridge/types.js").HandlerEntry>} */
export const trayHandlers = {
  "tray.inspect": { run: inspect },
  "tray.open": { run: navigate },
  "tray.close": { run: navigate },
  "tray.activate": { run: navigate },
};

/** @param {import("../bridge/types.js").BridgeContext} ctx */
export async function settleTrayScreenshot(ctx) {
  const { request, clock, live } = ctx;
  const tray = live().trayControl;
  const state = tray?.owner && tray.customPanel ? await tray.read() : null;
  if (!state?.rendered) throw { reason: "targetUnavailable" };
  const revision = clock.current();
  const {
    uiGeneration,
    rendered: { rect, viewport, devicePixelRatio },
  } = state;
  if (!(viewport.width > 0 && viewport.height > 0)) throw { reason: "renderNotSettled" };
  const { expectedRevision, expectedUiGeneration } = request.params;
  if (expectedRevision !== undefined && expectedRevision !== revision) {
    throw { reason: "revisionConflict", details: { expectedRevision, currentRevision: revision } };
  }
  if (expectedUiGeneration !== undefined && expectedUiGeneration !== uiGeneration) {
    throw {
      reason: "uiGenerationConflict",
      details: { expectedUiGeneration, currentUiGeneration: uiGeneration },
    };
  }
  return {
    windowLabel: TRAY_WORKBENCH_LABEL,
    rect,
    viewport,
    devicePixelRatio,
    revision,
    uiGeneration,
  };
}
