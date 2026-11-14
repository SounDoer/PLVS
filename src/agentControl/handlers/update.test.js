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
      installationSupported: false,
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

  /** @returns {any} */
  function installable(overrides = {}) {
    return control("ok", {
      installationSupported: true,
      info: {
        status: "ok",
        latestVersion: "1.2.0",
        update: { id: "candidate-1", version: "1.2.0" },
        activity: { downloading: false, progress: null, readyVersion: null },
      },
      openDetails: vi.fn(),
      confirmInstall: vi.fn(async () => {}),
      ...overrides,
    });
  }

  it("installs the named version through About's details and confirmation after delivery", async () => {
    const updateControl = installable();
    const response = await updateHandlers["update.install"].run(
      context("update.install", { version: "1.2.0", expectedRevision: 0 }, updateControl)
    );
    expect(updateControl.openDetails).toHaveBeenCalledWith({ id: "candidate-1", version: "1.2.0" });
    expect(response.result).toEqual({ revision: 0, accepted: true, version: "1.2.0" });
    expect(response.awaitDelivery).toBe(true);
    expect(updateControl.confirmInstall).not.toHaveBeenCalled();
    await response.afterResponse();
    expect(updateControl.confirmInstall).toHaveBeenCalledWith("candidate-1");
  });

  it("refuses a different version, no update, an unsupported copy, or an install in progress", async () => {
    const run = (updateControl, version = "1.2.0") =>
      updateHandlers["update.install"].run(
        context("update.install", { version, expectedRevision: 0 }, updateControl)
      );
    await expect(run(installable(), "1.1.0")).rejects.toMatchObject({
      reason: "updateVersionMismatch",
      details: { requestedVersion: "1.1.0", availableVersion: "1.2.0" },
    });
    const none = installable();
    none.info = { ...none.info, update: undefined };
    await expect(run(none)).rejects.toMatchObject({ reason: "updateNotFound" });
    await expect(run(installable({ installationSupported: false }))).rejects.toMatchObject({
      reason: "updateInstallationUnsupported",
    });
    await expect(run(installable({ installStatus: "installing" }))).rejects.toMatchObject({
      reason: "busy",
    });
    const managed = installable();
    managed.info = { ...managed.info, status: "managed" };
    await expect(run(managed)).rejects.toMatchObject({ reason: "updateUnavailable" });
  });
});
