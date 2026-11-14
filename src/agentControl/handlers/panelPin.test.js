import { describe, expect, it, vi } from "vitest";

import { createRevisionClock } from "../bridge/revisionClock.js";
import { panelHandlers } from "./panel.js";

const PINNED_SIZE = { width: 320, height: 240 };

function context(method, params, { pinned = false, rendered = true } = {}) {
  const workspace = {
    panelsById: { spectrum: { moduleId: "spectrum" }, stats: { moduleId: "stats" } },
    pinnedPanelsById: pinned ? { spectrum: PINNED_SIZE } : {},
  };
  let pending = null;
  const control = {
    pinned,
    toggle: vi.fn(() => {
      const next = {
        ...workspace,
        pinnedPanelsById: control.pinned ? {} : { spectrum: PINNED_SIZE },
      };
      if (pending?.expectation.matches(next)) pending.resolve(8);
    }),
  };
  const state = {
    workspace,
    waitForWorkspacePersistenceEnqueue: vi.fn(async () => {}),
    uiNavigation: {
      getPanelPin: (id) => (rendered && id === "spectrum" ? control : null),
    },
  };
  const ctx = /** @type {any} */ ({
    requestId: "request-1",
    request: { method, params },
    clock: createRevisionClock({ onWake: () => {} }),
    settlement: {
      arm: (_name, expectation) =>
        new Promise((resolve) => {
          pending = { expectation, resolve };
        }),
      observed: (_name, committed) => committed,
    },
    flush: vi.fn(async () => {}),
    snap: state,
    live: () => state,
  });
  return { ctx, control, state };
}

describe("panel pin commands", () => {
  it("pins through the header's own toggle and waits for the committed workspace", async () => {
    const { ctx, control, state } = context("panel.pin", {
      panelId: "spectrum",
      expectedRevision: 0,
    });
    const response = await panelHandlers["panel.pin"].run(ctx);
    expect(control.toggle).toHaveBeenCalledOnce();
    expect(response.result).toEqual({
      revision: 8,
      changed: true,
      panelId: "spectrum",
      pinned: true,
    });
    expect(state.waitForWorkspacePersistenceEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({ pinnedPanelsById: { spectrum: PINNED_SIZE } })
    );
    expect(ctx.flush).toHaveBeenCalledOnce();
  });

  it("unpins a pinned panel", async () => {
    const { ctx, control } = context(
      "panel.unpin",
      { panelId: "spectrum", expectedRevision: 0 },
      { pinned: true }
    );
    const response = await panelHandlers["panel.unpin"].run(ctx);
    expect(control.toggle).toHaveBeenCalledOnce();
    expect(response.result).toMatchObject({ changed: true, pinned: false });
  });

  it("returns an unchanged result without toggling when the panel is already in that state", async () => {
    const { ctx, control } = context(
      "panel.pin",
      { panelId: "spectrum", expectedRevision: 0 },
      { pinned: true }
    );
    const response = await panelHandlers["panel.pin"].run(ctx);
    expect(control.toggle).not.toHaveBeenCalled();
    expect(response.result).toEqual({
      revision: 0,
      changed: false,
      panelId: "spectrum",
      pinned: true,
    });
  });

  it("refuses a stale revision, a missing panel, and a panel that is not the rendered tab", async () => {
    await expect(
      panelHandlers["panel.pin"].run(
        context("panel.pin", { panelId: "spectrum", expectedRevision: 3 }).ctx
      )
    ).rejects.toMatchObject({ reason: "revisionConflict" });
    await expect(
      panelHandlers["panel.pin"].run(
        context("panel.pin", { panelId: "loudness", expectedRevision: 0 }).ctx
      )
    ).rejects.toMatchObject({ reason: "panelNotFound" });
    const hidden = context(
      "panel.pin",
      { panelId: "stats", expectedRevision: 0 },
      { rendered: false }
    );
    await expect(panelHandlers["panel.pin"].run(hidden.ctx)).rejects.toMatchObject({
      reason: "controlUnavailable",
    });
    expect(hidden.control.toggle).not.toHaveBeenCalled();
  });

  it("follows the Fullscreen header, which offers only Unpin for the shown panel", async () => {
    const fullscreenPin = (panelId, pinned) => ({
      fullscreen: true,
      pinned,
      toggle: pinned ? vi.fn() : null,
    });
    const other = context("panel.pin", { panelId: "spectrum", expectedRevision: 0 });
    other.state.uiNavigation.getPanelPin = () => ({ fullscreen: true, pinned: null, toggle: null });
    await expect(panelHandlers["panel.pin"].run(other.ctx)).rejects.toMatchObject({
      reason: "controlUnavailable",
      message: expect.stringContaining("exit Fullscreen to pin"),
    });
    const shown = context("panel.pin", { panelId: "spectrum", expectedRevision: 0 });
    shown.state.uiNavigation.getPanelPin = () => fullscreenPin("spectrum", false);
    await expect(panelHandlers["panel.pin"].run(shown.ctx)).rejects.toMatchObject({
      reason: "controlUnavailable",
    });
  });
});
