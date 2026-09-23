/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

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
  beforeEach(() => {
    vi.resetModules();
    invoke.mockReset();
    delete document.documentElement.dataset.surface;
    seed();
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
