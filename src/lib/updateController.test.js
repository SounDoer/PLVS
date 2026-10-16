import { describe, expect, it, vi } from "vitest";
import { createUpdateController } from "./updateController.js";

const a = { id: "a", version: "2.0.0", manifest: { notes: "A" } };
const b = { id: "b", version: "3.0.0", manifest: { notes: "B" } };
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
