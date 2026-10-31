/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";

import { createRevisionClock } from "../bridge/revisionClock.js";
import { pointerHandlers } from "./pointer.js";

function context(params, pointerControl) {
  const state = { pointerControl };
  return /** @type {any} */ ({
    requestId: "request-1",
    request: { method: "pointer.move", params },
    clock: createRevisionClock({ onWake: () => {} }),
    snap: state,
    live: () => state,
  });
}

function control(overrides = {}) {
  return {
    available: true,
    windowVisible: true,
    scale: () => 1.5,
    move: vi.fn(async () => {}),
    ...overrides,
  };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("pointer move", () => {
  it("moves to the centre of a declared target and presses nothing", async () => {
    document.body.innerHTML = `<button data-ui-target="toolbar:presets"></button>`;
    document.querySelector("button").getBoundingClientRect = () => new DOMRect(700, 10, 28, 28);
    const pointerControl = control();

    const response = await pointerHandlers["pointer.move"].run(
      context({ target: "toolbar:presets", durationMs: 400, expectedRevision: 0 }, pointerControl)
    );

    expect(pointerControl.move).toHaveBeenCalledWith({
      x: 714,
      y: 24,
      durationMs: 400,
      webviewScale: 1.5,
    });
    expect(response.result).toMatchObject({ target: "toolbar:presets", point: { x: 714, y: 24 } });
  });

  it("uses the default duration and refuses undeclared or hidden targets", async () => {
    document.body.innerHTML = `<button data-ui-target="toolbar:clear"></button>`;
    document.querySelector("button").getBoundingClientRect = () => new DOMRect(0, 0, 0, 0);
    const pointerControl = control();

    await expect(
      pointerHandlers["pointer.move"].run(
        context({ target: "toolbar:missing", expectedRevision: 0 }, pointerControl)
      )
    ).rejects.toMatchObject({ reason: "uiTargetNotFound" });
    await expect(
      pointerHandlers["pointer.move"].run(
        context({ target: "toolbar:clear", expectedRevision: 0 }, pointerControl)
      )
    ).rejects.toMatchObject({ reason: "uiTargetNotVisible" });
    expect(pointerControl.move).not.toHaveBeenCalled();
  });

  it("is unavailable where the platform cannot move the pointer", async () => {
    await expect(
      pointerHandlers["pointer.move"].run(
        context({ target: "toolbar:presets", expectedRevision: 0 }, control({ available: false }))
      )
    ).rejects.toMatchObject({ reason: "controlUnavailable" });
  });
});
