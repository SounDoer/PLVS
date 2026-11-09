import { describe, expect, it, vi } from "vitest";
import { createUpdateController, releaseUrlForVersion } from "./updateController.js";
import { dockUpdateStatus } from "../dock/dockUpdateStatus.js";
import { buildAppStatusItems } from "./appStatus.js";

const a = { id: "a", version: "2.0.0", manifest: { notes: "A" } };
const b = { id: "b", version: "3.0.0", manifest: { notes: "B" } };

describe("releaseUrlForVersion", () => {
  it("targets one exact stable Release and rejects non-public fixture versions", () => {
    expect(releaseUrlForVersion("1.2.3")).toBe(
      "https://github.com/SounDoer/PLVS/releases/tag/v1.2.3"
    );
    expect(releaseUrlForVersion("99.0.0-development-fixture")).toBeNull();
    expect(releaseUrlForVersion(undefined)).toBeNull();
  });
});
const prefs = { choiceMade: true, autoCheck: true, autoDownload: true };
function deferred() {
  let resolve = (_value) => {};
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function setup(overrides = {}) {
  const invoke = vi.fn(
    /** @returns {Promise<any>} */ async (command) => {
      if (command === "update_status")
        return {
          enabled: true,
          installationSupported: true,
          freshSession: true,
          ready: null,
        };
      if (command === "update_check") return a;
      if (command === "update_download") return { ...a, id: "staged-a" };
      if (command === "update_prepare_install") return "token";
      return null;
    }
  );
  const deps = {
    invoke,
    prepare: vi.fn(async () => ({ id: "operation" })),
    commit: vi.fn(async () => {}),
    abort: vi.fn(async () => {}),
    openExternal: vi.fn(async () => {}),
    ...overrides,
  };
  return { controller: createUpdateController(deps), ...deps };
}

describe("shared update controller", () => {
  function statusItem(controller) {
    const state = controller.getSnapshot();
    const target = state.ready ?? state.candidate;
    return buildAppStatusItems({
      update: dockUpdateStatus({
        ...state,
        updateInfo: {
          status: state.checkStatus,
          hasUpdate: Boolean(target),
          latestVersion: target?.version,
        },
      }),
    })[0];
  }

  it.each([true, false])(
    "does not report a completed installation as failed when a check is offline (automatic=%s)",
    async (automatic) => {
      const { controller, invoke } = setup();
      await controller.setPreferences(prefs);
      invoke.mockResolvedValueOnce({
        enabled: true,
        installationSupported: true,
        freshSession: true,
        ready: null,
        attempt: { version: "0.25.0", phase: "finished", error: null },
      });
      await controller.initialize();
      invoke.mockRejectedValueOnce(new Error("Feed offline"));
      await controller.check(automatic);
      expect(controller.getSnapshot().error).toBeNull();
      expect(statusItem(controller)).toMatchObject({
        text: "Update Check Failed",
        action: "check-update",
      });
      expect(statusItem(controller).details).toContain(
        "installed version and metering are unaffected"
      );
      invoke.mockResolvedValueOnce(null);
      await controller.check(false);
      expect(controller.getSnapshot()).toMatchObject({ checkStatus: "ok", error: null });
      expect(statusItem(controller)).toBeUndefined();
    }
  );

  it("keeps a known candidate available after a check failure and successful retry", async () => {
    const { controller, invoke } = setup();
    await controller.initialize();
    await controller.check();
    invoke.mockRejectedValueOnce(new Error("Feed offline"));
    await controller.check();
    expect(statusItem(controller)).toMatchObject({ phase: "available", action: "update" });
    await controller.check();
    expect(controller.getSnapshot().error).toBeNull();
    expect(statusItem(controller)).toMatchObject({ phase: "available" });
  });

  it("preserves an actual installation failure across failed and successful checks", async () => {
    const { controller, invoke } = setup();
    invoke.mockResolvedValueOnce({
      enabled: true,
      installationSupported: true,
      ready: null,
      attempt: { version: a.version, phase: "failed", error: "Installer failed" },
    });
    await controller.initialize();
    invoke.mockRejectedValueOnce(new Error("Feed offline"));
    await controller.check();
    expect(statusItem(controller)).toMatchObject({ text: "Update Failed", action: "update" });
    invoke.mockResolvedValueOnce(null);
    await controller.check();
    expect(controller.getSnapshot().error).toBe("Installer failed");
    expect(statusItem(controller)).toMatchObject({ text: "Update Failed" });
  });

  it("keeps a staged startup offer installable when the background feed is offline", async () => {
    const { controller, invoke } = setup();
    await controller.setPreferences(prefs);
    invoke.mockResolvedValueOnce({
      enabled: true,
      installationSupported: true,
      freshSession: true,
      ready: a,
    });
    await controller.initialize({ eligible: true });
    invoke.mockRejectedValueOnce(new Error("Feed offline"));
    await controller.check(true);
    expect(controller.getSnapshot()).toMatchObject({
      checkStatus: "unavailable",
      error: null,
      details: { target: a, staged: true, origin: "startup" },
    });
    await controller.confirmInstall();
    expect(invoke).not.toHaveBeenCalledWith("update_download", expect.anything());
    expect(invoke).toHaveBeenCalledWith("update_commit_install", { token: "token" });
  });

  it.each(["2.0.0", "1.9.0"])(
    "suppresses only the failed target's startup offer (%s)",
    async (version) => {
      const { controller, invoke } = setup();
      await controller.setPreferences(prefs);
      invoke.mockResolvedValueOnce({
        enabled: true,
        installationSupported: true,
        freshSession: true,
        ready: a,
        attempt: { version, phase: "failed", error: "Installer failed" },
      });
      await controller.initialize({ eligible: true });
      expect(Boolean(controller.getSnapshot().details)).toBe(version !== a.version);
      expect(controller.getSnapshot().ready).toEqual(a);
    }
  );

  it("rechecks activity after asynchronous cache reconciliation", async () => {
    const pending = deferred();
    const { controller, invoke } = setup();
    await controller.setPreferences(prefs);
    invoke.mockImplementationOnce(() => pending.promise);
    let eligible = true;
    const initializing = controller.initialize({ eligible: () => eligible });
    eligible = false;
    pending.resolve({ enabled: true, installationSupported: true, freshSession: true, ready: a });
    await initializing;
    expect(controller.getSnapshot().details).toBeNull();
  });

  it("retains the failed target's recovery explanation when manually reopened offline", async () => {
    const { controller, invoke } = setup();
    await controller.setPreferences(prefs);
    invoke.mockResolvedValueOnce({
      enabled: true,
      installationSupported: true,
      freshSession: true,
      ready: a,
      attempt: {
        version: a.version,
        phase: "failed",
        error: "Installer exited with exit code: 42.",
      },
    });
    await controller.initialize({ eligible: true });
    invoke.mockRejectedValueOnce(new Error("Feed offline"));
    await controller.check(true);
    controller.openDetails();
    expect(controller.getSnapshot().error).toBe("Installer exited with exit code: 42.");
    controller.dismissDetails();
    controller.openDetails();
    expect(controller.getSnapshot().error).toBe("Installer exited with exit code: 42.");
    controller.dismissDetails();
    controller.openDetails(b);
    expect(controller.getSnapshot().error).toBeNull();
  });

  it("refocuses existing details without replacing their target", async () => {
    const { controller, invoke } = setup();
    await controller.initialize();
    await controller.check();
    controller.openDetails();
    const first = controller.getSnapshot().details;
    invoke.mockResolvedValueOnce(b);
    await controller.check();
    controller.openDetails();
    expect(controller.getSnapshot().details.target).toEqual(first.target);
    expect(controller.getSnapshot().details.presentation).toBeGreaterThan(first.presentation);
  });

  it("aborts the helper and restores workbenches after a partial global commit", async () => {
    const relaunch = vi.fn(async () => {});
    const { controller, invoke, abort } = setup({
      relaunch,
      commit: vi.fn(async () => {
        throw new Error("Peer commit failed");
      }),
    });
    await controller.initialize();
    await controller.check();
    controller.openDetails();
    await controller.confirmInstall();
    expect(invoke).toHaveBeenCalledWith("update_abort_install", { token: "token" });
    expect(invoke).not.toHaveBeenCalledWith("update_commit_install", expect.anything());
    expect(abort).toHaveBeenCalledOnce();
    expect(relaunch).toHaveBeenCalledOnce();
    expect(controller.getSnapshot().installStatus).toBe("install-error");
  });
  it("makes no automatic request before consent but allows an explicit check", async () => {
    const { controller, invoke } = setup();
    await controller.initialize();
    await controller.check(true);
    expect(invoke.mock.calls.map(([name]) => name)).toEqual(["update_status"]);
    await controller.check(false);
    expect(controller.getSnapshot().candidate).toEqual(a);
    expect(invoke).not.toHaveBeenCalledWith("update_download", expect.anything());
  });

  it("ignores a late automatic check after checking is disabled", async () => {
    const { controller, invoke } = setup();
    await controller.initialize();
    await controller.setPreferences(prefs);
    const pending = deferred();
    invoke.mockImplementationOnce(() => pending.promise);
    const check = controller.check(true);
    await controller.setPreferences({ ...prefs, autoCheck: false });
    pending.resolve(a);
    await check;
    expect(controller.getSnapshot().candidate).toBeNull();
    expect(invoke).not.toHaveBeenCalledWith("update_download", expect.anything());
  });

  it("stages in the background without opening details in an active session", async () => {
    const { controller } = setup();
    await controller.setPreferences(prefs);
    await controller.initialize({ eligible: true });
    await controller.check(true);
    expect(controller.getSnapshot().ready.id).toBe("staged-a");
    expect(controller.getSnapshot().details).toBeNull();
  });

  it("promotes open details when their background download finishes", async () => {
    const pending = deferred();
    const { controller, invoke, prepare } = setup();
    await controller.setPreferences(prefs);
    await controller.initialize();
    invoke.mockResolvedValueOnce(a).mockImplementationOnce(() => pending.promise);

    const checking = controller.check(true);
    await vi.waitFor(() => expect(controller.getSnapshot().downloading).toBe(true));
    controller.openDetails();
    await controller.confirmInstall();
    expect(prepare).not.toHaveBeenCalled();
    expect(controller.getSnapshot().error).toBeNull();

    const ready = { ...a, id: "staged-a" };
    pending.resolve(ready);
    await checking;
    expect(controller.getSnapshot()).toMatchObject({
      ready,
      downloading: false,
      downloadProgress: null,
      error: null,
      details: { target: ready, staged: true, origin: "manual" },
    });

    await controller.confirmInstall();
    expect(invoke).toHaveBeenCalledWith("update_prepare_install", {
      packageId: "staged-a",
      startup: false,
    });
  });

  it("offers an eligible cached target only once and skip retains the cache", async () => {
    const { controller, invoke } = setup();
    await controller.setPreferences(prefs);
    const status = { enabled: true, installationSupported: true, freshSession: true, ready: a };
    invoke.mockResolvedValueOnce(status);
    await controller.initialize({ eligible: true });
    expect(controller.getSnapshot().details.target.id).toBe("a");
    controller.dismissDetails();
    invoke.mockResolvedValueOnce(status);
    await controller.initialize({ eligible: true });
    expect(controller.getSnapshot().details).toBeNull();
    expect(controller.getSnapshot().ready).toEqual(a);
  });

  it("keeps the confirmed target frozen when a later check discovers another version", async () => {
    const { controller, invoke } = setup();
    await controller.initialize();
    await controller.check();
    controller.openDetails();
    invoke.mockResolvedValueOnce(b);
    await controller.check();
    await controller.confirmInstall();
    expect(invoke).toHaveBeenCalledWith("update_download", { candidateId: "a", automatic: false });
    expect(invoke).toHaveBeenCalledWith("update_prepare_install", {
      packageId: "staged-a",
      startup: false,
    });
  });

  it("does not stop any workbench when a startup peer check refuses installation", async () => {
    const { controller, invoke, prepare } = setup();
    await controller.setPreferences(prefs);
    invoke.mockResolvedValueOnce({
      enabled: true,
      installationSupported: true,
      freshSession: true,
      ready: a,
    });
    await controller.initialize({ eligible: true });
    invoke.mockRejectedValueOnce(new Error("Another workbench is active"));
    await controller.confirmInstall();
    expect(prepare).not.toHaveBeenCalled();
    expect(controller.getSnapshot().installStatus).toBe("install-error");
  });

  it("releases the installer gate when an editor or persistence guard refuses prepare", async () => {
    const { controller, invoke, commit } = setup({
      prepare: vi.fn(async () => {
        throw new Error("Open editor");
      }),
    });
    await controller.initialize();
    await controller.check();
    controller.openDetails();
    await controller.confirmInstall();
    expect(commit).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledWith("update_abort_install", { token: "token" });
    expect(controller.getSnapshot().error).toContain("Open editor");
  });

  it("routes Portable to the release download without preparing any installer", async () => {
    const { controller, invoke, prepare, openExternal } = setup();
    invoke.mockResolvedValueOnce({
      enabled: true,
      installationSupported: false,
      freshSession: false,
      ready: null,
    });
    await controller.initialize();
    await controller.check();
    controller.openDetails();
    await controller.confirmInstall();
    expect(openExternal).toHaveBeenCalledOnce();
    expect(prepare).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalledWith("update_download", expect.anything());
  });

  it("rejects duplicate confirmations and stale accessory targets", async () => {
    const pending = deferred();
    const { controller, prepare } = setup({ prepare: vi.fn(() => pending.promise) });
    await controller.initialize();
    await controller.check();
    controller.openDetails();
    await controller.confirmInstall("old-target");
    expect(prepare).not.toHaveBeenCalled();
    const first = controller.confirmInstall();
    await controller.confirmInstall();
    await vi.waitFor(() => expect(prepare).toHaveBeenCalledOnce());
    controller.dismissDetails();
    expect(controller.getSnapshot().details).not.toBeNull();
    pending.resolve({ id: "operation" });
    await first;
  });
});

it("keeps a failed replacement download separate from a usable cached update", async () => {
  const { controller, invoke } = setup();
  await controller.setPreferences(prefs);
  invoke.mockResolvedValueOnce({ enabled: true, installationSupported: true, ready: a });
  await controller.initialize({ eligible: false });
  invoke.mockResolvedValueOnce(b).mockRejectedValueOnce(new Error("Disk full"));
  await controller.check(true);
  expect(controller.getSnapshot()).toMatchObject({
    ready: a,
    downloadError: "Error: Disk full",
    downloading: false,
  });
  await controller.setPreferences({ ...prefs, autoDownload: false });
  expect(controller.getSnapshot()).toMatchObject({ ready: null, downloadError: null });
});

describe("tutorial update preview", () => {
  async function ready() {
    const context = setup();
    await context.controller.setPreferences({ ...prefs, autoCheck: false, autoDownload: false });
    await context.controller.initialize();
    return context;
  }

  it("reports the next patch as an ordinary candidate that the real status entry shows", async () => {
    const { controller } = await ready();
    expect(controller.previewUpdate("fixture-1", "0.25.1")).toBe(true);
    expect(controller.getSnapshot().candidate).toEqual({
      id: "fixture-1",
      version: "0.25.2",
      manifest: { notes: "- Improvements and fixes." },
      preview: true,
    });
    expect(controller.previewUpdate("fixture-2", "0.25.1")).toBe(false);
  });

  it("opens the real details as a fixture that never downloads or installs", async () => {
    const { controller, invoke, prepare } = await ready();
    controller.previewUpdate("fixture-1", "0.25.1");
    controller.openDetails();
    expect(controller.getSnapshot().details).toMatchObject({
      origin: "fixture",
      target: { id: "fixture-1", version: "0.25.2" },
    });
    await controller.confirmInstall();
    expect(controller.getSnapshot().error).toMatch(/cannot install/);
    expect(prepare).not.toHaveBeenCalled();
    const commands = invoke.mock.calls.map(([command]) => command);
    expect(commands).not.toContain("update_download");
    expect(commands).not.toContain("update_prepare_install");
  });

  it("clears only its own candidate and details", async () => {
    const { controller } = await ready();
    controller.previewUpdate("fixture-1", "0.25.1");
    controller.openDetails();
    controller.clearPreview("other");
    expect(controller.getSnapshot().candidate?.id).toBe("fixture-1");
    controller.clearPreview("fixture-1");
    expect(controller.getSnapshot()).toMatchObject({ candidate: null, details: null });
  });
});
