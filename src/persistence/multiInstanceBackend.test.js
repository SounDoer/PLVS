/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

function deferred() {
  /** @type {(value?: any) => void} */
  let resolve = () => {};
  const promise = new Promise((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function seed() {
  window.__PLVS_INITIAL_STATE__ = {
    "plvs:settings": {
      referenceLufs: -23,
      loudnessProfiles: {
        active: "profile:broadcast",
        profiles: [{ id: "broadcast", name: "Broadcast" }],
      },
    },
    "plvs:workspace": { panelOrder: ["loudness"] },
    "plvs:presets": {
      activeId: "one",
      dirty: false,
      list: [
        { id: "one", name: "One" },
        { id: "two", name: "Two" },
      ],
    },
    "plvs:themes": { themes: {}, order: [] },
    multiInstancePersistence: {
      itemRevisions: {
        preset: { one: 3, two: 4 },
        loudnessProfile: { broadcast: 2 },
        theme: {},
      },
      collectionRevisions: { preset: 7, loudnessProfile: 2, theme: 0 },
      globalPreferenceRevisions: { askToSendCrashReports: 5 },
    },
    globalPreferences: { askToSendCrashReports: true },
  };
}

describe("multiInstanceBackend", () => {
  it.each(["already saved", "different value", "unavailable"])(
    "keeps Workspace writes moving when a shared preference conflicts and hydration is %s",
    async (outcome) => {
      const conflict = { reason: "conflict", message: "Expected revision 5, found 6" };
      invoke.mockImplementation(async (command, args) => {
        if (command === "persistence_hydrate") {
          if (outcome === "unavailable") throw new Error("Temporarily unavailable");
          return {
            globalPreferences: { askToSendCrashReports: outcome !== "already saved" },
            globalPreferenceRevisions: { askToSendCrashReports: 6 },
          };
        }
        if (command === "persistence_save_global_preferences") {
          if (args.expectedRevisions.askToSendCrashReports === 5) throw conflict;
          return { askToSendCrashReports: 7 };
        }
      });
      const { createMultiInstanceBackend } = await import("./multiInstanceBackend.js");
      const backend = createMultiInstanceBackend();
      backend.set("plvs:settings", {
        ...backend.get("plvs:settings"),
        askToSendCrashReports: false,
        referenceLufs: -20,
      });
      const workspace = { panelOrder: ["waveform"] };
      backend.set("plvs:workspace", workspace);

      if (outcome === "already saved") await backend.flush();
      else
        await expect(backend.flush()).rejects.toMatchObject({
          reason: "globalPreferenceConflict",
          preference: "askToSendCrashReports",
        });
      expect(backend.get("plvs:settings")).toMatchObject({
        askToSendCrashReports: outcome !== "already saved",
        referenceLufs: -20,
      });
      expect(invoke).toHaveBeenCalledWith("persistence_save_domain", {
        domain: "workspace",
        value: workspace,
      });
      await expect(backend.flush()).resolves.toBeUndefined();
      if (outcome === "different value") {
        backend.set("plvs:settings", {
          ...backend.get("plvs:settings"),
          askToSendCrashReports: false,
        });
        await backend.flush();
        expect(invoke).toHaveBeenCalledWith("persistence_save_global_preferences", {
          values: { askToSendCrashReports: false },
          expectedRevisions: { askToSendCrashReports: 6 },
        });
      }
    }
  );

  it("holds writes from a stale workbench while a configuration change awaits restart", async () => {
    invoke.mockResolvedValue(undefined);
    const { createMultiInstanceBackend } = await import("./multiInstanceBackend.js");
    const backend = createMultiInstanceBackend();
    const resumeWrites = await backend.pauseWrites();
    const value = { ...backend.get("plvs:settings"), referenceLufs: -20 };
    backend.set("plvs:settings", value);
    await backend.flush();
    await backend.refresh();
    expect(invoke).not.toHaveBeenCalled();

    resumeWrites();
    await backend.flush();
    expect(invoke).toHaveBeenCalledExactlyOnceWith("persistence_save_domain", {
      domain: "settings",
      value,
    });
  });

  it("persists the tour disposition as an identity-wide preference with its revision", async () => {
    window.__PLVS_INITIAL_STATE__["plvs:settings"].quickTour = "pending";
    window.__PLVS_INITIAL_STATE__.globalPreferences.quickTour = "pending";
    window.__PLVS_INITIAL_STATE__.multiInstancePersistence.globalPreferenceRevisions.quickTour = 3;
    invoke.mockResolvedValueOnce({ quickTour: 4 }).mockResolvedValue(undefined);
    const { createMultiInstanceBackend } = await import("./multiInstanceBackend.js");
    const backend = createMultiInstanceBackend();
    backend.set("plvs:settings", { ...backend.get("plvs:settings"), quickTour: "dismissed" });
    await backend.flush();
    expect(invoke).toHaveBeenNthCalledWith(1, "persistence_save_global_preferences", {
      values: { quickTour: "dismissed" },
      expectedRevisions: { quickTour: 3 },
    });
  });

  it("applies peer update preferences without overwriting local workspace settings", async () => {
    const updatePreferences = { choiceMade: true, autoCheck: false, autoDownload: false };
    invoke.mockResolvedValueOnce({
      presets: {
        list: [
          { id: "one", name: "One" },
          { id: "two", name: "Two" },
        ],
      },
      themes: { themes: {}, order: [] },
      settings: {
        referenceLufs: -10,
        loudnessProfiles: { profiles: [{ id: "broadcast", name: "Broadcast" }] },
      },
      globalPreferences: { askToSendCrashReports: true, updatePreferences, quickTour: "completed" },
      globalPreferenceRevisions: { askToSendCrashReports: 5, updatePreferences: 2 },
      libraryItemRevisions: {
        preset: { one: 3, two: 4 },
        theme: {},
        loudnessProfile: { broadcast: 2 },
      },
      libraryCollectionRevisions: { preset: 7, theme: 0, loudnessProfile: 2 },
    });
    const { createMultiInstanceBackend } = await import("./multiInstanceBackend.js");
    const backend = createMultiInstanceBackend();
    const changed = vi.fn();
    const unsubscribe = backend.subscribe("plvs:settings", changed);
    await backend.refresh();
    expect(backend.get("plvs:settings")).toMatchObject({
      referenceLufs: -23,
      updatePreferences,
      quickTour: "completed",
    });
    expect(changed).toHaveBeenCalledWith({ origin: "remote" });
    expect(invoke).not.toHaveBeenCalledWith("persistence_save_domain", expect.anything());
    unsubscribe();
  });

  beforeEach(() => {
    vi.resetModules();
    invoke.mockReset();
    delete document.documentElement.dataset.surface;
    seed();
  });

  it("follows a peer's Crash Report Prompt so a later save cannot revert it", async () => {
    window.__PLVS_INITIAL_STATE__["plvs:settings"].askToSendCrashReports = true;
    invoke.mockResolvedValueOnce({
      presets: {
        list: [
          { id: "one", name: "One" },
          { id: "two", name: "Two" },
        ],
      },
      themes: { themes: {}, order: [] },
      settings: { loudnessProfiles: { profiles: [{ id: "broadcast", name: "Broadcast" }] } },
      globalPreferences: { askToSendCrashReports: false },
      globalPreferenceRevisions: { askToSendCrashReports: 6 },
      libraryItemRevisions: {
        preset: { one: 3, two: 4 },
        theme: {},
        loudnessProfile: { broadcast: 2 },
      },
      libraryCollectionRevisions: { preset: 7, theme: 0, loudnessProfile: 2 },
    });
    const { createMultiInstanceBackend } = await import("./multiInstanceBackend.js");
    const backend = createMultiInstanceBackend();
    await backend.refresh();
    expect(backend.get("plvs:settings").askToSendCrashReports).toBe(false);

    invoke.mockResolvedValue(undefined);
    backend.set("plvs:settings", { ...backend.get("plvs:settings"), referenceLufs: -24 });
    await backend.flush();
    expect(invoke).not.toHaveBeenCalledWith(
      "persistence_save_global_preferences",
      expect.objectContaining({ values: { askToSendCrashReports: true } })
    );
  });

  it("persists an active Preset change only to the owning workspace", async () => {
    const { createMultiInstanceBackend } = await import("./multiInstanceBackend.js");
    const backend = createMultiInstanceBackend();
    backend.set("plvs:presets", {
      ...backend.get("plvs:presets"),
      activeId: "two",
      dirty: true,
    });
    await backend.flush();

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("persistence_save_domain", {
      domain: "presets",
      value: expect.objectContaining({ activeId: "two", dirty: true }),
    });
  });

  it("persists crash consent as a shared global preference", async () => {
    invoke.mockResolvedValueOnce({ askToSendCrashReports: 6 }).mockResolvedValue(undefined);
    const { createMultiInstanceBackend } = await import("./multiInstanceBackend.js");
    const backend = createMultiInstanceBackend();
    backend.set("plvs:settings", {
      ...backend.get("plvs:settings"),
      askToSendCrashReports: false,
    });
    await backend.flush();

    expect(invoke).toHaveBeenNthCalledWith(1, "persistence_save_global_preferences", {
      values: { askToSendCrashReports: false },
      expectedRevisions: { askToSendCrashReports: 5 },
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "persistence_save_domain", {
      domain: "settings",
      value: expect.objectContaining({ askToSendCrashReports: false }),
    });
  });

  it("keeps Dock accessory surfaces read-only", async () => {
    document.documentElement.dataset.surface = "dock-editor";
    const { createMultiInstanceBackend } = await import("./multiInstanceBackend.js");
    const backend = createMultiInstanceBackend();

    expect(() => backend.set("plvs:settings", { referenceLufs: -8 })).toThrow(/dock-editor/);
    expect(() => backend.remove("plvs:presets")).toThrow(/dock-editor/);
    delete document.documentElement.dataset.surface;
  });

  it("updates one shared item with its item revision instead of replacing the collection", async () => {
    invoke.mockResolvedValueOnce({
      item: { id: "one", revision: 4, document: { id: "one", name: "Changed" } },
      collectionRevision: 8,
    });
    const { createMultiInstanceBackend } = await import("./multiInstanceBackend.js");
    const backend = createMultiInstanceBackend();
    backend.set("plvs:presets", {
      ...backend.get("plvs:presets"),
      list: [
        { id: "one", name: "Changed" },
        { id: "two", name: "Two" },
      ],
    });
    await backend.flush();

    expect(invoke).toHaveBeenNthCalledWith(1, "persistence_library_update", {
      kind: "preset",
      id: "one",
      expectedRevision: 3,
      document: { id: "one", name: "Changed" },
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "persistence_save_domain", {
      domain: "presets",
      value: expect.any(Object),
    });
  });

  it("uses an atomic replacement for a multi-item import", async () => {
    invoke.mockResolvedValueOnce({
      items: [
        { id: "three", revision: 1, document: { id: "three" } },
        { id: "four", revision: 1, document: { id: "four" } },
      ],
      collectionRevision: 8,
    });
    const { createMultiInstanceBackend } = await import("./multiInstanceBackend.js");
    const backend = createMultiInstanceBackend();
    backend.set("plvs:presets", {
      activeId: null,
      list: [{ id: "three" }, { id: "four" }],
    });
    await backend.flush();

    expect(invoke).toHaveBeenNthCalledWith(1, "persistence_library_replace", {
      kind: "preset",
      documents: [{ id: "three" }, { id: "four" }],
      expectedCollectionRevision: 7,
      expectedItemRevisions: { one: 3, two: 4 },
    });
  });

  it("surfaces a conflict at the durable flush boundary without discarding the local draft", async () => {
    const conflict = { reason: "conflict", message: "changed by another instance" };
    invoke.mockRejectedValueOnce(conflict);
    const { createMultiInstanceBackend } = await import("./multiInstanceBackend.js");
    const backend = createMultiInstanceBackend();
    const changed = {
      ...backend.get("plvs:presets"),
      list: [
        { id: "one", name: "Local Draft" },
        { id: "two", name: "Two" },
      ],
    };
    backend.set("plvs:presets", changed);

    await expect(backend.flush()).rejects.toBe(conflict);
    expect(backend.get("plvs:presets")).toEqual(changed);
  });

  it.each(["reorder", "replace"])(
    "isolates a Library %s conflict while continuing Workspace saves",
    async (operation) => {
      const failure = { reason: "conflict", message: "Library changed elsewhere" };
      const { createMultiInstanceBackend } = await import("./multiInstanceBackend.js");
      const backend = createMultiInstanceBackend();
      const observe = vi.fn();
      backend.subscribeLibraryConflicts(observe);
      const presets = backend.get("plvs:presets");
      const [one, two] = presets.list;
      const peer = { id: "peer", name: "Added by another workbench" };
      const command = `persistence_library_${operation}`;
      const send = invoke.mockImplementation(async (method, params) => {
        if (method === command && params.expectedCollectionRevision === 7) throw failure;
        if (method === "persistence_hydrate") {
          return {
            presets: { list: [one, two, peer] },
            libraryCollectionRevisions: { preset: 8 },
            libraryItemRevisions: { preset: { one: 3, two: 4, peer: 1 } },
          };
        }
        if (method === "persistence_library_reorder") return 9;
      });

      backend.set("plvs:presets", {
        ...presets,
        list: [operation === "replace" ? { ...two, name: "Local edit" } : two, one],
      });
      const workspace = { panelOrder: ["waveform"] };
      backend.set("plvs:workspace", workspace);
      await expect(backend.flush()).rejects.toBe(failure);
      expect(observe).toHaveBeenLastCalledWith({ kind: "preset", operation: "collection" });
      expect(send).toHaveBeenCalledWith("persistence_save_domain", {
        domain: "workspace",
        value: workspace,
      });

      const nextWorkspace = { panelOrder: ["spectrum"] };
      backend.set("plvs:workspace", nextWorkspace);
      backend.set("plvs:presets", { ...backend.get("plvs:presets"), activeId: "two" });
      await expect(backend.flush()).resolves.toBeUndefined();
      expect(send).toHaveBeenCalledWith("persistence_save_domain", {
        domain: "workspace",
        value: nextWorkspace,
      });
      expect(send.mock.calls.filter(([method]) => method === command)).toHaveLength(1);
      await expect(backend.resolveLibraryConflict("copy")).rejects.toThrow(
        "Unknown Library conflict action"
      );
      await backend.resolveLibraryConflict("reload");
      expect(backend.get("plvs:presets")).toMatchObject({
        list: [one, two, peer],
        activeId: "two",
      });
      expect(observe).toHaveBeenLastCalledWith(null);

      backend.set("plvs:presets", { ...backend.get("plvs:presets"), list: [two, one, peer] });
      await backend.flush();
      expect(send).toHaveBeenCalledWith("persistence_library_reorder", {
        kind: "preset",
        orderedIds: ["two", "one", "peer"],
        expectedCollectionRevision: 8,
      });
    }
  );

  it("publishes a known-stale editor draft without first overwriting the remote item", async () => {
    const { createMultiInstanceBackend } = await import("./multiInstanceBackend.js");
    const backend = createMultiInstanceBackend();
    const observed = [];
    backend.subscribeLibraryConflicts((value) => observed.push(value));
    const document = { id: "one", name: "Open Draft" };

    backend.reportLibraryConflict("preset", document);

    expect(observed.at(-1)).toEqual({ kind: "preset", id: "one", document });
    expect(invoke).not.toHaveBeenCalledWith("persistence_library_update", expect.anything());
  });

  it("keeps development conflict provenance private and resets only the exact fixture", async () => {
    const { createMultiInstanceBackend } = await import("./multiInstanceBackend.js");
    const backend = createMultiInstanceBackend();
    const observed = [];
    backend.subscribeLibraryConflicts((value) => observed.push(value));

    backend.establishDevelopmentLibraryConflict("fixture-aaaaaaaaaaaaaaaa", {
      kind: "preset",
      document: { id: "fixture-preset", name: "Fixture Preset" },
    });

    expect(observed.at(-1)).toEqual({
      kind: "preset",
      id: "fixture-preset",
      document: { id: "fixture-preset", name: "Fixture Preset" },
    });
    expect(observed.at(-1)).not.toHaveProperty("fixtureId");
    expect(backend.matchesDevelopmentLibraryConflict("fixture-aaaaaaaaaaaaaaaa")).toBe(true);
    backend.resetDevelopmentLibraryConflict("fixture-bbbbbbbbbbbbbbbb");
    expect(observed.at(-1)).not.toBeNull();
    backend.resetDevelopmentLibraryConflict("fixture-aaaaaaaaaaaaaaaa");
    expect(observed.at(-1)).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("does not replace a real library conflict with a development fixture", async () => {
    const { createMultiInstanceBackend } = await import("./multiInstanceBackend.js");
    const backend = createMultiInstanceBackend();
    const document = { id: "one", name: "Real Draft" };
    backend.reportLibraryConflict("preset", document);

    expect(() =>
      backend.establishDevelopmentLibraryConflict("fixture-aaaaaaaaaaaaaaaa", {
        kind: "preset",
        document: { id: "fixture-preset", name: "Fixture Preset" },
      })
    ).toThrow(expect.objectContaining({ reason: "fixtureConflict" }));
  });

  it("reloads or saves a conflicting item as a fresh copy without force-overwriting", async () => {
    const conflict = { reason: "conflict", message: "changed by another instance" };
    invoke.mockRejectedValueOnce(conflict);
    const { createMultiInstanceBackend } = await import("./multiInstanceBackend.js");
    const backend = createMultiInstanceBackend();
    const observed = [];
    backend.subscribeLibraryConflicts((value) => observed.push(value));
    backend.set("plvs:presets", {
      ...backend.get("plvs:presets"),
      list: [
        { id: "one", name: "Local Draft" },
        { id: "two", name: "Two" },
      ],
    });
    await expect(backend.flush()).rejects.toBe(conflict);
    expect(observed.at(-1)).toMatchObject({ kind: "preset", id: "one" });

    invoke
      .mockResolvedValueOnce({
        presets: {
          list: [
            { id: "one", name: "Remote" },
            { id: "two", name: "Two" },
          ],
        },
        themes: { themes: {}, order: [] },
        settings: { loudnessProfiles: { profiles: [] } },
        globalPreferences: {},
        globalPreferenceRevisions: {},
        libraryItemRevisions: { preset: { one: 4, two: 4 }, theme: {}, loudnessProfile: {} },
        libraryCollectionRevisions: { preset: 8, theme: 0, loudnessProfile: 0 },
      })
      .mockResolvedValueOnce({
        item: { id: "copy-id", revision: 1, document: { id: "copy-id" } },
        collectionRevision: 9,
      })
      .mockResolvedValueOnce(undefined);

    const copy = await backend.resolveLibraryConflict("copy", { makeId: () => "copy-id" });

    expect(copy).toEqual({ id: "copy-id", name: "Local Draft Copy" });
    expect(invoke).toHaveBeenCalledWith("persistence_library_create", {
      kind: "preset",
      id: "copy-id",
      document: copy,
    });
    expect(backend.get("plvs:presets").list).toEqual([
      { id: "one", name: "Remote" },
      { id: "two", name: "Two" },
      copy,
    ]);
    expect(observed.at(-1)).toBeNull();
  });

  it.each([
    { kind: "preset", id: "one", key: "plvs:presets", domain: "presets" },
    { kind: "loudnessProfile", id: "broadcast", key: "plvs:settings", domain: "settings" },
  ])(
    "finishes saving the same $kind copy after a failed Workspace write",
    async ({ kind, id, key, domain }) => {
      const { createMultiInstanceBackend } = await import("./multiInstanceBackend.js");
      const backend = createMultiInstanceBackend();
      const observe = vi.fn();
      backend.subscribeLibraryConflicts(observe);
      const remote = { id, name: "Remote" };
      const peerAddition = { id: "peer", name: "Peer Addition" };
      const durable = [remote];
      const failure = new Error("Workspace write failed");
      const firstWrite = deferred();
      let workspaceWriteCount = 0;
      const collection = (documents) =>
        kind === "preset" ? { list: documents } : { loudnessProfiles: { profiles: documents } };
      invoke.mockImplementation(async (command, args) => {
        if (command === "persistence_hydrate") {
          return {
            [domain]: collection([...durable]),
            libraryItemRevisions: {
              [kind]: Object.fromEntries(durable.map(({ id }) => [id, 4])),
            },
            libraryCollectionRevisions: { [kind]: 7 + durable.length },
          };
        }
        if (command === "persistence_library_create") {
          durable.push(args.document);
          return { item: { id: args.id, revision: 1 }, collectionRevision: 7 + durable.length };
        }
        if (command === "persistence_save_domain" && ++workspaceWriteCount === 1) {
          await firstWrite.promise;
          throw failure;
        }
      });
      backend.reportLibraryConflict(kind, { id, name: "Local Draft" });

      const first = backend.resolveLibraryConflict("copy", { makeId: () => "copy-id" });
      await vi.waitFor(() => expect(workspaceWriteCount).toBe(1));
      const concurrent = backend.resolveLibraryConflict("copy", { makeId: () => "extra-copy" });
      expect(concurrent).toBe(first);
      const failed = expect(first).rejects.toBe(failure);
      firstWrite.resolve();
      await failed;
      expect(observe).toHaveBeenLastCalledWith(expect.objectContaining({ kind, id }));

      durable.push(peerAddition);
      const copy = { id: "copy-id", name: "Local Draft Copy" };
      const retryId = vi.fn(() => "extra-copy");
      await expect(backend.resolveLibraryConflict("copy", { makeId: retryId })).resolves.toEqual(
        copy
      );
      expect(retryId).not.toHaveBeenCalled();
      expect(durable).toEqual([remote, copy, peerAddition]);
      expect(backend.get(key)).toMatchObject(collection(durable));
      expect(invoke).toHaveBeenLastCalledWith("persistence_save_domain", {
        domain,
        value: backend.get(key),
      });
      expect(workspaceWriteCount).toBe(2);
      expect(observe).toHaveBeenLastCalledWith(null);
    }
  );

  it("saves other Workspace settings after reloading a conflicting profile", async () => {
    const { createMultiInstanceBackend } = await import("./multiInstanceBackend.js");
    const backend = createMultiInstanceBackend();
    const conflict = { reason: "conflict", message: "changed by another instance" };
    const remote = { id: "broadcast", name: "Remote" };
    const channelLabelOverrides = { 2: ["R", "L"] };
    invoke
      .mockRejectedValueOnce(conflict)
      .mockResolvedValueOnce({
        settings: { loudnessProfiles: { profiles: [remote] } },
        libraryItemRevisions: { loudnessProfile: { broadcast: 3 } },
        libraryCollectionRevisions: { loudnessProfile: 3 },
      })
      .mockResolvedValueOnce(undefined);
    backend.set("plvs:settings", {
      ...backend.get("plvs:settings"),
      channelLabelOverrides,
      loudnessProfiles: {
        active: "profile:broadcast",
        profiles: [{ id: remote.id, name: "Local" }],
      },
    });
    await expect(backend.flush()).rejects.toBe(conflict);
    await backend.resolveLibraryConflict("reload");
    await backend.flush();

    expect(backend.get("plvs:settings")).toMatchObject({
      channelLabelOverrides,
      loudnessProfiles: { active: "profile:broadcast", profiles: [remote] },
    });
    expect(invoke.mock.calls.map(([command]) => command)).toEqual([
      "persistence_library_update",
      "persistence_hydrate",
      "persistence_save_domain",
    ]);
    expect(invoke).toHaveBeenLastCalledWith("persistence_save_domain", {
      domain: "settings",
      value: backend.get("plvs:settings"),
    });
  });

  it("retries the failed write and any later queued domains after a conflict", async () => {
    const conflict = { reason: "conflict", message: "changed by another instance" };
    invoke
      .mockRejectedValueOnce(conflict)
      .mockResolvedValueOnce({
        item: { id: "one", revision: 4, document: { id: "one", name: "Local Draft" } },
        collectionRevision: 8,
      })
      .mockResolvedValue(undefined);
    const { createMultiInstanceBackend } = await import("./multiInstanceBackend.js");
    const backend = createMultiInstanceBackend();
    backend.set("plvs:presets", {
      ...backend.get("plvs:presets"),
      list: [
        { id: "one", name: "Local Draft" },
        { id: "two", name: "Two" },
      ],
    });
    backend.set("plvs:workspace", { panelOrder: ["spectrum"] });

    await expect(backend.flush()).rejects.toBe(conflict);
    await expect(backend.flush()).resolves.toBeUndefined();

    expect(invoke).toHaveBeenCalledWith("persistence_save_domain", {
      domain: "workspace",
      value: { panelOrder: ["spectrum"] },
    });
  });

  it.each(["before", "after"])(
    "keeps a peer edit when hydration returns %s the local write settles",
    async (timing) => {
      const pending = deferred();
      const initial = structuredClone(window.__PLVS_INITIAL_STATE__);
      const local = { id: "one", name: "Local Edit" };
      const peer = { id: "two", name: "Peer Edit" };
      const hydrated = {
        presets: { list: [initial["plvs:presets"].list[0], peer] },
        libraryItemRevisions: { preset: { one: 3, two: 5 } },
        libraryCollectionRevisions: { preset: 8 },
      };
      invoke
        .mockReturnValueOnce(pending.promise)
        .mockResolvedValueOnce({ item: { id: "one", revision: 4 }, collectionRevision: 9 })
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({
          ...hydrated,
          presets: { list: [local, peer] },
          libraryItemRevisions: { preset: { one: 4, two: 5 } },
          libraryCollectionRevisions: { preset: 9 },
        });
      const { createMultiInstanceBackend } = await import("./multiInstanceBackend.js");
      const backend = createMultiInstanceBackend();
      const refreshing = backend.refresh();
      backend.set("plvs:presets", {
        ...backend.get("plvs:presets"),
        list: [local, initial["plvs:presets"].list[1]],
      });
      if (timing === "before") {
        pending.resolve(hydrated);
        await refreshing;
      }
      await backend.flush();
      if (timing === "after") {
        pending.resolve(hydrated);
        await refreshing;
      }

      expect(invoke).toHaveBeenCalledWith("persistence_library_update", {
        kind: "preset",
        id: "one",
        expectedRevision: 3,
        document: local,
      });
      expect(invoke.mock.calls.map(([command]) => command)).not.toContain(
        "persistence_library_replace"
      );
      await backend.refresh();
      expect(backend.get("plvs:presets").list).toEqual([local, peer]);
    }
  );

  it("deletes only the selected item and reloads after a delete conflict", async () => {
    const conflict = { reason: "conflict", message: "Item changed elsewhere" };
    const peer = { id: "one", name: "Peer Edit" };
    const remaining = { id: "two", name: "Two" };
    invoke
      .mockRejectedValueOnce(conflict)
      .mockResolvedValueOnce({
        presets: { list: [peer, remaining] },
        libraryItemRevisions: { preset: { one: 4, two: 4 } },
        libraryCollectionRevisions: { preset: 8 },
      })
      .mockResolvedValueOnce(9)
      .mockResolvedValueOnce(undefined);

    const { createMultiInstanceBackend } = await import("./multiInstanceBackend.js");
    const backend = createMultiInstanceBackend();
    const observe = vi.fn();
    backend.subscribeLibraryConflicts(observe);
    const remove = () => backend.set("plvs:presets", { list: [remaining], activeId: null });
    remove();

    await expect(backend.flush()).rejects.toBe(conflict);
    expect(observe).toHaveBeenLastCalledWith({ kind: "preset", id: "one", operation: "delete" });
    await expect(backend.flush()).rejects.toBe(conflict);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("persistence_library_delete", {
      kind: "preset",
      id: "one",
      expectedRevision: 3,
    });

    await backend.resolveLibraryConflict("reload");
    expect(observe).toHaveBeenLastCalledWith(null);
    expect(backend.get("plvs:presets").list).toEqual([peer, remaining]);
    remove();
    await backend.flush();
    expect(invoke).toHaveBeenNthCalledWith(3, "persistence_library_delete", {
      kind: "preset",
      id: "one",
      expectedRevision: 4,
    });
  });

  it("publishes both imported collections together only after the transaction succeeds", async () => {
    const pending = deferred();
    const preset = { id: "new", loudnessProfileActive: "profile:bundled" };
    const profile = { id: "bundled", name: "Bundled" };
    const additions = { preset: [preset], loudnessProfile: [profile] };
    const kinds = ["preset", "loudnessProfile"];
    const validate = vi.fn();
    const failure = { reason: "storage", message: "Disk full" };
    invoke.mockRejectedValueOnce(failure).mockReturnValueOnce(pending.promise);

    const { createMultiInstanceBackend } = await import("./multiInstanceBackend.js");
    const backend = createMultiInstanceBackend();
    const observer = vi.fn(() => {
      expect(backend.get("plvs:presets").list.at(-1)).toEqual(preset);
      expect(backend.get("plvs:settings").loudnessProfiles.profiles.at(-1)).toEqual(profile);
    });
    const unsubscribe = backend.subscribe("plvs:presets", observer);
    const unsubscribeSettings = backend.subscribe("plvs:settings", observer);
    try {
      await expect(backend.appendLibrary(additions, kinds, validate)).rejects.toBe(failure);
      expect(backend.get("plvs:presets").list.map(({ id }) => id)).toEqual(["one", "two"]);
      expect(backend.get("plvs:settings").loudnessProfiles.profiles.map(({ id }) => id)).toEqual([
        "broadcast",
      ]);
      expect(observer).not.toHaveBeenCalled();

      const appending = backend.appendLibrary(additions, kinds, validate);
      await Promise.resolve();
      expect(observer).not.toHaveBeenCalled();
      expect(invoke).toHaveBeenLastCalledWith("persistence_library_append", {
        additions,
        expectedRevisions: { preset: 7, loudnessProfile: 2 },
        expectedItemRevisions: { preset: { one: 3, two: 4 }, loudnessProfile: { broadcast: 2 } },
      });
      pending.resolve({ preset: 8, loudnessProfile: 3 });
      await appending;
      expect(observer).toHaveBeenCalledTimes(2);
    } finally {
      unsubscribe();
      unsubscribeSettings();
    }
  });

  it("checks shared revisions without appending and refreshes a stale existing-item review", async () => {
    const conflict = { reason: "conflict", message: "Changed in another workbench" };
    const remote = { id: "broadcast", name: "Peer Edit" };
    invoke
      .mockRejectedValueOnce(conflict)
      .mockResolvedValueOnce({
        settings: { loudnessProfiles: { profiles: [remote] } },
        libraryItemRevisions: { loudnessProfile: { broadcast: 3 } },
        libraryCollectionRevisions: { loudnessProfile: 3 },
        globalPreferences: { askToSendCrashReports: true },
        globalPreferenceRevisions: { askToSendCrashReports: 5 },
      })
      .mockResolvedValueOnce({});
    const { createMultiInstanceBackend } = await import("./multiInstanceBackend.js");
    const backend = createMultiInstanceBackend();
    const validate = vi.fn();

    await expect(backend.appendLibrary({}, ["loudnessProfile"], validate)).rejects.toBe(conflict);
    expect(invoke).toHaveBeenNthCalledWith(1, "persistence_library_append", {
      additions: {},
      expectedRevisions: { loudnessProfile: 2 },
      expectedItemRevisions: { loudnessProfile: { broadcast: 2 } },
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "persistence_hydrate");
    expect(backend.get("plvs:settings").loudnessProfiles.profiles).toEqual([remote]);

    await backend.appendLibrary({}, ["loudnessProfile"], validate);
    expect(invoke).toHaveBeenNthCalledWith(3, "persistence_library_append", {
      additions: {},
      expectedRevisions: { loudnessProfile: 3 },
      expectedItemRevisions: { loudnessProfile: { broadcast: 3 } },
    });
    expect(backend.get("plvs:settings").loudnessProfiles.profiles).toEqual([remote]);
  });

  it("refreshes a peer Library change without replacing the active Preset selection", async () => {
    invoke.mockResolvedValueOnce({
      presets: { activeId: "two", list: [{ id: "one", name: "Changed Elsewhere" }] },
      themes: { themes: {}, order: [] },
      settings: { loudnessProfiles: { profiles: [{ id: "broadcast" }] } },
      globalPreferences: { askToSendCrashReports: true },
      globalPreferenceRevisions: { askToSendCrashReports: 5 },
      libraryItemRevisions: {
        preset: { one: 4 },
        theme: {},
        loudnessProfile: { broadcast: 2 },
      },
      libraryCollectionRevisions: { preset: 8, theme: 0, loudnessProfile: 2 },
    });
    const { createMultiInstanceBackend } = await import("./multiInstanceBackend.js");
    const backend = createMultiInstanceBackend();
    const changed = vi.fn();
    const unsubscribe = backend.subscribe("plvs:presets", changed);

    await backend.refresh();

    expect(backend.get("plvs:presets")).toEqual({
      activeId: "one",
      dirty: false,
      list: [{ id: "one", name: "Changed Elsewhere" }],
    });
    expect(changed).toHaveBeenCalledTimes(1);
    expect(changed).toHaveBeenCalledWith({ origin: "remote" });
    unsubscribe();
  });

  it("does not report its own write as a peer change when Rust returns it with sorted keys", async () => {
    // `serde_json` hands every object back with its keys in alphabetical order. The same document
    // in another key order is not a change, and announcing it as one re-renders the library and
    // advances the Agent Control revision a second time for a single save.
    const saved = { id: "three", name: "Three", tree: { type: "leaf" }, panelsById: {} };
    const echoed = { id: "three", name: "Three", panelsById: {}, tree: { type: "leaf" } };
    invoke.mockImplementation(async (command) => {
      if (command === "persistence_library_create") {
        return { item: { revision: 1 }, collectionRevision: 8 };
      }
      if (command === "persistence_hydrate") {
        return {
          presets: {
            list: [{ id: "one", name: "One" }, { id: "two", name: "Two" }, echoed],
          },
          themes: { themes: {}, order: [] },
          settings: { loudnessProfiles: { profiles: [{ id: "broadcast", name: "Broadcast" }] } },
          globalPreferences: { askToSendCrashReports: true },
          globalPreferenceRevisions: { askToSendCrashReports: 5 },
          libraryItemRevisions: {
            preset: { one: 3, two: 4, three: 1 },
            theme: {},
            loudnessProfile: { broadcast: 2 },
          },
          libraryCollectionRevisions: { preset: 8, theme: 0, loudnessProfile: 2 },
        };
      }
      return undefined;
    });
    const { createMultiInstanceBackend } = await import("./multiInstanceBackend.js");
    const backend = createMultiInstanceBackend();
    const current = backend.get("plvs:presets");
    backend.set("plvs:presets", { ...current, list: [...current.list, saved] });
    await backend.flush();
    const changed = vi.fn();
    const unsubscribe = backend.subscribe("plvs:presets", changed);

    await backend.refresh();

    expect(changed).not.toHaveBeenCalled();
    expect(JSON.stringify(backend.get("plvs:presets").list.at(-1))).toBe(JSON.stringify(saved));
    unsubscribe();
  });

  it("reconciles authoritative Library contents even when the revision is already known", async () => {
    invoke.mockResolvedValueOnce({
      presets: {
        activeId: "two",
        list: [
          { id: "one", name: "One" },
          { id: "two", name: "Two" },
          { id: "peer", name: "Peer Addition" },
        ],
      },
      themes: { themes: {}, order: [] },
      settings: { loudnessProfiles: { profiles: [{ id: "broadcast" }] } },
      globalPreferences: { askToSendCrashReports: true },
      globalPreferenceRevisions: { askToSendCrashReports: 5 },
      libraryItemRevisions: {
        preset: { one: 3, two: 4, peer: 1 },
        theme: {},
        loudnessProfile: { broadcast: 2 },
      },
      libraryCollectionRevisions: { preset: 7, theme: 0, loudnessProfile: 2 },
    });
    const { createMultiInstanceBackend } = await import("./multiInstanceBackend.js");
    const backend = createMultiInstanceBackend();

    await backend.refresh();

    expect(backend.get("plvs:presets").list).toContainEqual({
      id: "peer",
      name: "Peer Addition",
    });
  });
});
