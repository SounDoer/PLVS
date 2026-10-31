import { describe, expect, it, vi } from "vitest";

import { createRevisionClock } from "../bridge/revisionClock.js";
import { updateHandlers } from "./update.js";

function context(method, params, updateControl) {
  const state = { updateControl };
  return /** @type {any} */ ({
    requestId: "request-1",
    request: { method, params },
    clock: createRevisionClock({ onWake: () => {} }),
    snap: state,
    live: () => state,
  });
}

function control(status, overrides = {}) {
  return {
    initialized: true,
    installStatus: "idle",
    info: {
      status,
      latestVersion: "1.2.0",
      releaseNotes: "Private notes",
      update: { url: "https://example.invalid/package" },
      activity: { downloading: true, progress: 0.25, readyVersion: null },
    },
    check: vi.fn(async () => {}),
    ...overrides,
  };
}

describe("Update Control", () => {
  it("reports the update state without release notes or package details", async () => {
    const response = await updateHandlers["update.inspect"].run(
      context("update.inspect", {}, control("ok"))
    );

    expect(response.result).toEqual({
      revision: 0,
      enabled: true,
      status: "ok",
      latestVersion: "1.2.0",
      downloading: true,
      downloadProgress: 0.25,
      readyVersion: null,
      installStatus: "idle",
    });
  });

  it("runs one manual check through the About page's path", async () => {
    const updateControl = control("idle");
    const response = await updateHandlers["update.check"].run(
      context("update.check", { expectedRevision: 0 }, updateControl)
    );

    expect(updateControl.check).toHaveBeenCalledOnce();
    expect(response.result).toMatchObject({ revision: 0, status: "idle" });
  });

  it("refuses a check where this workbench does not update itself", async () => {
    for (const status of ["managed", "disabled"]) {
      const updateControl = control(status);
      await expect(
        updateHandlers["update.check"].run(
          context("update.check", { expectedRevision: 0 }, updateControl)
        )
      ).rejects.toMatchObject({ reason: "updateUnavailable", details: { status } });
      expect(updateControl.check).not.toHaveBeenCalled();
    }
  });
});
