import { invoke } from "@tauri-apps/api/core";
import { LOUDNESS_PROFILE_OFF, profileSelectionId } from "../lib/loudnessProfileCatalog.js";

const FLUSH_DELAY_MS = 200;
const REFRESH_INTERVAL_MS = 1000;
const DOMAIN_KIND = {
  "plvs:presets": "preset",
  "plvs:themes": "theme",
  "plvs:sourceMixes": "sourceMix",
};

function clone(value) {
  return value == null ? value : structuredClone(value);
}

/**
 * @param {string} key
 */
function documentsFor(key, value) {
  if (key === "plvs:presets" || key === "plvs:sourceMixes")
    return Array.isArray(value?.list) ? value.list : [];
  if (key === "plvs:themes") {
    const themes = value?.themes && typeof value.themes === "object" ? value.themes : {};
    const order = Array.isArray(value?.order) ? value.order : [];
    const seen = new Set();
    const documents = [];
    for (const id of order) {
      if (themes[id] && !seen.has(id)) {
        documents.push(themes[id]);
        seen.add(id);
      }
    }
    for (const id of Object.keys(themes).sort()) {
      if (!seen.has(id)) documents.push(themes[id]);
    }
    return documents;
  }
  if (key === "plvs:settings") {
    return Array.isArray(value?.loudnessProfiles?.profiles) ? value.loudnessProfiles.profiles : [];
  }
  return null;
}

/**
 * @param {string} key
 */
function kindFor(key) {
  if (key === "plvs:settings") return "loudnessProfile";
  return DOMAIN_KIND[key] ?? null;
}

/**
 * @param {string} key
 */
function domainFor(key) {
  if (key === "plvs:settings") return "settings";
  if (key === "plvs:workspace") return "workspace";
  if (key === "plvs:presets") return "presets";
  return null;
}

function collectionKey(kind) {
  return Object.keys(DOMAIN_KIND).find((key) => DOMAIN_KIND[key] === kind) ?? "plvs:settings";
}

function withCollection(kind, current, documents) {
  if (kind === "preset" || kind === "sourceMix") return { ...current, list: documents };
  if (kind === "theme") {
    return {
      themes: Object.fromEntries(documents.map((item) => [item.id, item])),
      order: documents.map((item) => item.id),
    };
  }
  return { ...current, loudnessProfiles: { ...current.loudnessProfiles, profiles: documents } };
}

function signature(value) {
  return JSON.stringify(value);
}

/// For comparing a document with its own copy read back from Rust, where `serde_json` returns
/// every object with its keys sorted. `signature` would call that copy a change.
function keyOrderInsensitiveSignature(value) {
  return JSON.stringify(value, (_key, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, item[key]])
        )
      : item
  );
}

function indexDocuments(documents) {
  return new Map(documents.map((document) => [document.id, document]));
}

function assertWritableSurface(key) {
  const surface = typeof document !== "undefined" ? document.documentElement.dataset.surface : null;
  if (import.meta.env.DEV && surface) {
    throw new Error(
      `[PLVS] "${key}" written from the ${surface} webview, which cannot persist; forward an action to the main window instead.`
    );
  }
}

export function createMultiInstanceBackend() {
  const seed = (typeof window !== "undefined" && window.__PLVS_INITIAL_STATE__) || {};
  const metadata = seed.multiInstancePersistence || {};
  const cache = new Map(
    ["plvs:settings", "plvs:workspace", "plvs:presets", "plvs:themes", "plvs:sourceMixes"]
      .filter((key) => seed[key] && typeof seed[key] === "object")
      .map((key) => [key, clone(seed[key])])
  );
  const persistedDocuments = new Map();
  const itemRevisions = new Map();
  const collectionRevisions = new Map();
  const globalPreferenceRevisions = new Map(
    Object.entries(metadata.globalPreferenceRevisions || {})
  );
  const persistedGlobalPreferences = new Map(Object.entries(seed.globalPreferences || {}));
  if (
    !persistedGlobalPreferences.has("askToSendCrashReports") &&
    cache.get("plvs:settings") &&
    Object.hasOwn(cache.get("plvs:settings"), "askToSendCrashReports")
  ) {
    persistedGlobalPreferences.set(
      "askToSendCrashReports",
      cache.get("plvs:settings").askToSendCrashReports
    );
  }
  for (const [key, value] of cache) {
    const kind = kindFor(key);
    if (!kind) continue;
    persistedDocuments.set(kind, clone(documentsFor(key, value)));
    itemRevisions.set(kind, new Map(Object.entries(metadata.itemRevisions?.[kind] || {})));
    collectionRevisions.set(kind, metadata.collectionRevisions?.[kind] ?? 0);
  }

  const dirty = new Map();
  const editGenerations = new Map();
  const subscribers = new Map();
  let flushTimer = null;
  let refreshTimer = null;
  let activeDrain = null;
  let activeRefresh = null;
  let activeAppend = null;
  let writesPaused = false;
  let unreportedFailure = null;
  let pendingConflict = null;
  const collectionConflicts = new Map();
  const itemConflicts = new Map();
  let activeConflictResolution = null;
  const committedConflictCopies = new WeakMap();
  let pendingDeleteFailure = null;
  let pendingConflictDevelopmentFixtureId = null;
  const conflictSubscribers = new Set();

  function itemConflictKey(conflict) {
    return JSON.stringify([conflict.kind, conflict.id]);
  }

  function publishConflict(conflict, developmentFixtureId = null) {
    if (conflict.document && !developmentFixtureId) {
      const key = itemConflictKey(conflict);
      const known = itemConflicts.get(key);
      if (
        known &&
        known !== conflict &&
        keyOrderInsensitiveSignature(known.document) ===
          keyOrderInsensitiveSignature(conflict.document)
      )
        return;
      itemConflicts.set(key, conflict);
      if (pendingConflict && pendingConflict !== conflict && !pendingConflictDevelopmentFixtureId)
        return;
    }
    pendingConflict = conflict;
    if (conflict.operation !== "delete") pendingDeleteFailure = null;
    pendingConflictDevelopmentFixtureId = developmentFixtureId;
    for (const listener of conflictSubscribers) listener(clone(conflict));
  }

  function clearConflict(conflict = pendingConflict) {
    if (pendingConflict !== conflict) return;
    if (conflict?.document && !pendingConflictDevelopmentFixtureId) {
      const key = itemConflictKey(conflict);
      if (itemConflicts.get(key) === conflict) itemConflicts.delete(key);
    }
    pendingConflict = null;
    pendingDeleteFailure = null;
    pendingConflictDevelopmentFixtureId = null;
    const next = collectionConflicts.values().next().value;
    const nextConflict = next?.conflict ?? itemConflicts.values().next().value;
    if (nextConflict) publishConflict(nextConflict);
    else for (const listener of conflictSubscribers) listener(null);
  }

  async function persistCollection(kind, nextDocuments) {
    const previousDocuments = persistedDocuments.get(kind) || [];
    if (signature(previousDocuments) === signature(nextDocuments)) return;
    const previousById = indexDocuments(previousDocuments);
    const nextById = indexDocuments(nextDocuments);
    const revisions = itemRevisions.get(kind) || new Map();
    const removed = [...previousById.keys()].filter((id) => !nextById.has(id));
    const added = [...nextById.keys()].filter((id) => !previousById.has(id));
    const changed = [...nextById.keys()].filter(
      (id) =>
        previousById.has(id) && signature(previousById.get(id)) !== signature(nextById.get(id))
    );
    const previousOrder = previousDocuments.map((document) => document.id);
    const nextOrder = nextDocuments.map((document) => document.id);
    const orderChanged = signature(previousOrder) !== signature(nextOrder);

    if (!added.length && !removed.length && changed.length === 1 && !orderChanged) {
      const id = changed[0];
      let result;
      try {
        result = await invoke("persistence_library_update", {
          kind,
          id,
          expectedRevision: revisions.get(id),
          document: nextById.get(id),
        });
      } catch (error) {
        if (String(error?.reason || "").toLowerCase() === "conflict") {
          publishConflict({ kind, id, document: clone(nextById.get(id)) });
        }
        throw error;
      }
      revisions.set(id, result.item.revision);
      collectionRevisions.set(kind, result.collectionRevision);
    } else if (
      added.length === 1 &&
      !removed.length &&
      !changed.length &&
      nextOrder.at(-1) === added[0] &&
      signature(previousOrder) === signature(nextOrder.slice(0, -1))
    ) {
      const id = added[0];
      const result = await invoke("persistence_library_create", {
        kind,
        id,
        document: nextById.get(id),
      });
      revisions.set(id, result.item.revision);
      collectionRevisions.set(kind, result.collectionRevision);
    } else if (
      removed.length === 1 &&
      !added.length &&
      !changed.length &&
      signature(previousOrder.filter((id) => id !== removed[0])) === signature(nextOrder)
    ) {
      const id = removed[0];
      let collectionRevision;
      try {
        collectionRevision = await invoke("persistence_library_delete", {
          kind,
          id,
          expectedRevision: revisions.get(id),
        });
      } catch (error) {
        if (error?.reason === "conflict") {
          pendingDeleteFailure = error;
          publishConflict({ kind, id, operation: "delete" });
        }
        throw error;
      }
      revisions.delete(id);
      collectionRevisions.set(kind, collectionRevision);
    } else {
      const expectedCollectionRevision = collectionRevisions.get(kind) ?? 0;
      try {
        if (!added.length && !removed.length && !changed.length && orderChanged) {
          const revision = await invoke("persistence_library_reorder", {
            kind,
            orderedIds: nextOrder,
            expectedCollectionRevision,
          });
          collectionRevisions.set(kind, revision);
        } else {
          const result = await invoke("persistence_library_replace", {
            kind,
            documents: nextDocuments,
            expectedCollectionRevision,
            expectedItemRevisions: Object.fromEntries(revisions),
          });
          itemRevisions.set(kind, new Map(result.items.map((item) => [item.id, item.revision])));
          collectionRevisions.set(kind, result.collectionRevision);
        }
      } catch (error) {
        if (error?.reason !== "conflict") throw error;
        const conflict = { kind, operation: "collection" };
        collectionConflicts.set(kind, { conflict, error });
        unreportedFailure ??= error;
        if (!pendingConflict) publishConflict(conflict);
        return;
      }
    }
    persistedDocuments.set(kind, clone(nextDocuments));
  }

  async function persistGlobalPreference(key, attempted) {
    if (
      keyOrderInsensitiveSignature(persistedGlobalPreferences.get(key)) ===
      keyOrderInsensitiveSignature(attempted)
    )
      return;
    const revision = globalPreferenceRevisions.get(key) ?? 0;
    try {
      const revisions = await invoke("persistence_save_global_preferences", {
        values: { [key]: attempted },
        expectedRevisions: { [key]: revision },
      });
      persistedGlobalPreferences.set(key, attempted);
      globalPreferenceRevisions.set(key, revisions[key]);
    } catch (error) {
      if (error?.reason !== "conflict") throw error;
      // Reconcile just the rejected field. The settings domain also contains local edits
      // that should still reach disk, even when the refresh itself fails.
      const hydrated = await invoke("persistence_hydrate").catch(() => null);
      const value = hydrated
        ? hydrated.globalPreferences?.[key]
        : persistedGlobalPreferences.get(key);
      if (hydrated) {
        const currentRevision = hydrated.globalPreferenceRevisions?.[key] ?? 0;
        persistedGlobalPreferences.set(key, clone(value));
        globalPreferenceRevisions.set(key, currentRevision);
        seed.globalPreferences = { ...seed.globalPreferences, [key]: clone(value) };
        metadata.globalPreferenceRevisions = {
          ...metadata.globalPreferenceRevisions,
          [key]: currentRevision,
        };
      }
      if (
        hydrated &&
        keyOrderInsensitiveSignature(value) === keyOrderInsensitiveSignature(attempted)
      )
        return;
      unreportedFailure ??= Object.assign(new Error(error.message), {
        reason: "globalPreferenceConflict",
        preference: key,
      });
      const settings = cache.get("plvs:settings") || {};
      if (keyOrderInsensitiveSignature(settings[key]) === keyOrderInsensitiveSignature(attempted)) {
        cache.set("plvs:settings", { ...settings, [key]: clone(value) });
        notify("plvs:settings", { origin: "remote" });
      }
      if (hydrated) window.dispatchEvent(new CustomEvent("plvs-global-preferences-changed"));
    }
  }

  /**
   * @param {string} key
   */
  async function persistKey(key) {
    const value = cache.get(key) || {};
    if (key === "plvs:settings" && Object.hasOwn(value, "askToSendCrashReports")) {
      await persistGlobalPreference("askToSendCrashReports", value.askToSendCrashReports);
    }
    if (key === "plvs:settings" && Object.hasOwn(value, "updatePreferences")) {
      await persistGlobalPreference("updatePreferences", value.updatePreferences);
    }
    if (key === "plvs:settings" && Object.hasOwn(value, "quickTour")) {
      await persistGlobalPreference("quickTour", value.quickTour);
    }
    const kind = kindFor(key);
    if (kind && !collectionConflicts.has(kind)) {
      await persistCollection(kind, documentsFor(key, value));
    }
    // Rust saves Workspace fields separately from the shared documents in the same snapshot.
    const domain = domainFor(key);
    if (domain) await invoke("persistence_save_domain", { domain, value });
  }

  function hasPendingDelete(key) {
    return pendingConflict?.operation === "delete" && collectionKey(pendingConflict.kind) === key;
  }

  function writableKeys() {
    return [...dirty.keys()].filter((key) => !hasPendingDelete(key));
  }

  function markDirty(key) {
    editGenerations.set(key, (editGenerations.get(key) ?? 0) + 1);
    dirty.set(key, true);
    schedule();
  }

  async function drain() {
    for (let keys = writableKeys(); !writesPaused && keys.length; keys = writableKeys()) {
      for (const key of keys) dirty.delete(key);
      for (let index = 0; index < keys.length; index += 1) {
        try {
          await persistKey(keys[index]);
        } catch (error) {
          const firstPending = hasPendingDelete(keys[index]) ? index + 1 : index;
          for (const pendingKey of keys.slice(firstPending)) dirty.set(pendingKey, true);
          throw error;
        }
      }
    }
  }

  function ensureDrain() {
    if (activeAppend || writesPaused) return null;
    if (!writableKeys().length) return activeDrain;
    if (activeDrain) return activeDrain;
    const running = drain().catch((error) => {
      unreportedFailure ??= error;
    });
    activeDrain = running;
    running.then(() => {
      if (activeDrain !== running) return;
      activeDrain = null;
      if (!unreportedFailure) ensureDrain();
    });
    return running;
  }

  function schedule() {
    if (!flushTimer) {
      flushTimer = setTimeout(() => {
        flushTimer = null;
        ensureDrain();
      }, FLUSH_DELAY_MS);
    }
  }

  /**
   * @param {string} key
   */
  function notify(key, event) {
    for (const listener of subscribers.get(key) || []) listener(event);
  }

  /**
   * @param {string} kind
   */
  function applyRemoteCollection(kind, hydrated, force = false) {
    const remoteRevision = hydrated.libraryCollectionRevisions?.[kind] ?? 0;
    const key = collectionKey(kind);
    if (dirty.has(key)) return;
    const current = cache.get(key) || {};
    const domain = key.slice("plvs:".length);
    const remoteDocuments = documentsFor(key, hydrated[domain]);
    const next = withCollection(kind, current, remoteDocuments);
    const currentRevision = collectionRevisions.get(kind) ?? 0;
    if (remoteRevision < currentRevision) return;
    if (
      !force &&
      remoteRevision === currentRevision &&
      keyOrderInsensitiveSignature(remoteDocuments) ===
        keyOrderInsensitiveSignature(persistedDocuments.get(kind) || [])
    ) {
      return;
    }
    persistedDocuments.set(kind, clone(remoteDocuments));
    itemRevisions.set(kind, new Map(Object.entries(hydrated.libraryItemRevisions?.[kind] || {})));
    collectionRevisions.set(kind, remoteRevision);
    cache.set(key, clone(next));
    notify(key, { origin: "remote" });
  }

  async function refresh() {
    if (writesPaused || activeAppend || activeDrain || dirty.size) return;
    if (activeRefresh) return activeRefresh;
    const startedAt = new Map(editGenerations);
    // A save can begin and finish while hydration is in flight. Compare edit generations as
    // well as dirty state so a response cannot replace the baseline of that save.
    const canApply = (key) =>
      !writesPaused && !hasPendingDelete(key) && startedAt.get(key) === editGenerations.get(key);
    const refreshing = invoke("persistence_hydrate")
      .then((hydrated) => {
        for (const kind of ["preset", "theme", "loudnessProfile", "sourceMix"]) {
          if (!collectionConflicts.has(kind) && canApply(collectionKey(kind))) {
            applyRemoteCollection(kind, hydrated);
          }
        }
        if (!canApply("plvs:settings")) return;
        const nextGlobals = { ...hydrated.globalPreferences };
        const nextRevisions = { ...hydrated.globalPreferenceRevisions };
        // A direct writer (for example, Open at Login) can complete while hydration is in flight.
        for (const [key, revision] of Object.entries(metadata.globalPreferenceRevisions || {})) {
          if (revision > (nextRevisions[key] ?? 0)) {
            nextGlobals[key] = seed.globalPreferences?.[key];
            nextRevisions[key] = revision;
          }
        }
        if (
          keyOrderInsensitiveSignature([
            seed.globalPreferences ?? {},
            metadata.globalPreferenceRevisions ?? {},
          ]) !== keyOrderInsensitiveSignature([nextGlobals, nextRevisions]) ||
          keyOrderInsensitiveSignature(Object.fromEntries(persistedGlobalPreferences)) !==
            keyOrderInsensitiveSignature(nextGlobals)
        ) {
          persistedGlobalPreferences.clear();
          for (const [key, value] of Object.entries(nextGlobals))
            persistedGlobalPreferences.set(key, clone(value));
          globalPreferenceRevisions.clear();
          for (const [key, revision] of Object.entries(nextRevisions))
            globalPreferenceRevisions.set(key, revision);
          seed.globalPreferences = clone(nextGlobals);
          metadata.globalPreferenceRevisions = nextRevisions;
          const settings = cache.get("plvs:settings") || {};
          // Every identity-wide preference this workbench caches in its settings must follow a
          // peer's write. A stale cached value would be written back by this workbench's next
          // settings save, silently reverting the peer's change.
          const sharedAskToSend = Object.hasOwn(nextGlobals, "askToSendCrashReports");
          if (
            signature(settings.updatePreferences) !== signature(nextGlobals.updatePreferences) ||
            signature(settings.quickTour) !== signature(nextGlobals.quickTour) ||
            (sharedAskToSend &&
              settings.askToSendCrashReports !== nextGlobals.askToSendCrashReports)
          ) {
            cache.set("plvs:settings", {
              ...settings,
              updatePreferences: clone(nextGlobals.updatePreferences),
              quickTour: clone(nextGlobals.quickTour),
              ...(sharedAskToSend
                ? { askToSendCrashReports: nextGlobals.askToSendCrashReports }
                : {}),
            });
            notify("plvs:settings", { origin: "remote" });
          }
          window.dispatchEvent(new CustomEvent("plvs-global-preferences-changed"));
        }
      })
      .catch(() => {})
      .finally(() => {
        if (activeRefresh === refreshing) activeRefresh = null;
      });
    activeRefresh = refreshing;
    return refreshing;
  }

  async function flush() {
    while (activeAppend) await activeAppend.catch(() => {});
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    ensureDrain();
    while (activeDrain) await activeDrain;
    if (unreportedFailure) {
      const failure = unreportedFailure;
      unreportedFailure = null;
      throw failure;
    }
    if (pendingDeleteFailure) throw pendingDeleteFailure;
  }

  async function pauseWrites() {
    writesPaused = true;
    await activeAppend?.catch(() => {});
    await activeDrain;
    return () => {
      writesPaused = false;
      schedule();
    };
  }

  async function appendLibrary(additions, kinds, validate) {
    for (const kind of Object.keys(additions)) assertWritableSurface(collectionKey(kind));
    await flush();
    if (
      writesPaused ||
      activeAppend ||
      activeDrain ||
      writableKeys().length ||
      kinds.some((kind) => hasPendingDelete(collectionKey(kind)) || collectionConflicts.has(kind))
    ) {
      throw new Error("The Library is still saving. Try importing again.");
    }
    validate();
    const expectedRevisions = Object.fromEntries(
      kinds.map((kind) => [kind, collectionRevisions.get(kind) ?? 0])
    );
    const expectedItemRevisions = Object.fromEntries(
      kinds.map((kind) => [kind, Object.fromEntries(itemRevisions.get(kind) ?? [])])
    );
    for (const kind of kinds) {
      const key = collectionKey(kind);
      editGenerations.set(key, (editGenerations.get(key) ?? 0) + 1);
    }
    const appending = invoke("persistence_library_append", {
      additions,
      expectedRevisions,
      expectedItemRevisions,
    }).then((revisions) => {
      const keys = [];
      for (const [kind, items] of Object.entries(additions)) {
        const key = collectionKey(kind);
        const current = cache.get(key) || {};
        const visible = documentsFor(key, current);
        const itemVersions = itemRevisions.get(kind) ?? new Map();
        for (const item of items) itemVersions.set(item.id, 1);
        itemRevisions.set(kind, itemVersions);
        collectionRevisions.set(kind, revisions[kind]);
        persistedDocuments.set(kind, clone([...(persistedDocuments.get(kind) || []), ...items]));
        cache.set(key, clone(withCollection(kind, current, [...visible, ...items])));
        keys.push(key);
      }
      for (const key of keys) notify(key, { origin: "import" });
    });
    activeAppend = appending;
    try {
      await appending;
    } catch (error) {
      if (error?.reason === "conflict" && !Object.keys(additions).length) {
        activeAppend = null;
        await activeRefresh;
        await refresh();
      }
      throw error;
    } finally {
      if (activeAppend === appending) activeAppend = null;
      ensureDrain();
    }
  }

  /**
   * @param {string} action
   */
  function resolveConflict(
    action,
    { makeId = /** @type {() => string} */ (() => crypto.randomUUID()) } = {}
  ) {
    activeConflictResolution ??= resolvePendingConflict(action, makeId).finally(() => {
      activeConflictResolution = null;
    });
    return activeConflictResolution;
  }

  async function preserveCollectionEdits(kind, key, hydrated) {
    const domain = key.slice("plvs:".length);
    const previous = indexDocuments(persistedDocuments.get(kind) || []);
    const remoteDocuments = documentsFor(key, hydrated[domain]);
    const remote = indexDocuments(remoteDocuments);
    const remoteRevisions = hydrated.libraryItemRevisions?.[kind] ?? {};
    const revisions = itemRevisions.get(kind);
    const conflicts = [];
    let wrote = false;
    for (const document of documentsFor(key, cache.get(key))) {
      const { id } = document;
      const baseline = previous.get(id);
      const latest = remote.get(id);
      if (keyOrderInsensitiveSignature(latest) === keyOrderInsensitiveSignature(document)) continue;
      if (
        baseline &&
        keyOrderInsensitiveSignature(baseline) === keyOrderInsensitiveSignature(document)
      )
        continue;

      if (
        baseline &&
        latest &&
        Number.isSafeInteger(remoteRevisions[id]) &&
        revisions?.get(id) === remoteRevisions[id]
      ) {
        try {
          await invoke("persistence_library_update", {
            kind,
            id,
            expectedRevision: remoteRevisions[id],
            document,
          });
          wrote = true;
          continue;
        } catch (error) {
          if (error?.reason !== "conflict") throw error;
        }
      }
      // Preserve a local version when a peer independently edited, deleted, or added the item.
      // An unsaved addition with a free ID can be created without changing anyone else's ordering.
      if (!baseline && !latest) {
        try {
          await invoke("persistence_library_create", { kind, id, document });
          wrote = true;
          continue;
        } catch (error) {
          if (error?.reason !== "conflict") throw error;
        }
      }
      conflicts.push({ kind, id, document: clone(document) });
    }
    return { hydrated: wrote ? await invoke("persistence_hydrate") : hydrated, conflicts };
  }

  async function resolvePendingConflict(action, makeId) {
    if (!pendingConflict) return null;
    const conflict = pendingConflict;
    if (action !== "reload" && (action !== "copy" || !conflict.document)) {
      throw new Error("Unknown Library conflict action.");
    }
    const key = collectionKey(conflict.kind);
    if (activeDrain) await activeDrain;
    const generation = editGenerations.get(key);
    let hydrated = await invoke("persistence_hydrate");
    let preservedConflicts = [];
    if (conflict.operation === "collection") {
      const preserved = await preserveCollectionEdits(conflict.kind, key, hydrated);
      hydrated = preserved.hydrated;
      preservedConflicts = preserved.conflicts;
    }
    if (editGenerations.get(key) !== generation) {
      throw new Error("Local Library changes are still arriving. Try Reload again.");
    }
    editGenerations.set(key, (editGenerations.get(key) ?? 0) + 1);
    const hadPendingChanges = dirty.delete(key);
    if (conflict.operation !== "collection") unreportedFailure = null;
    const deleting = conflict.operation === "delete";
    if (deleting) {
      const current = cache.get(key);
      if (
        conflict.kind === "preset" &&
        current?.activeId === null &&
        hydrated.presets?.activeId === conflict.id &&
        hydrated.presets.list?.some(({ id }) => id === conflict.id)
      ) {
        cache.set(key, { ...current, activeId: conflict.id });
      } else if (
        conflict.kind === "loudnessProfile" &&
        current?.loudnessProfiles?.active === LOUDNESS_PROFILE_OFF
      ) {
        const profileState = hydrated.settings?.loudnessProfiles;
        if (
          profileState?.active === profileSelectionId(conflict.id) &&
          profileState.profiles?.some(({ id }) => id === conflict.id)
        ) {
          cache.set(key, {
            ...current,
            loudnessProfiles: { ...current.loudnessProfiles, active: profileState.active },
          });
        }
      }
    }
    applyRemoteCollection(conflict.kind, hydrated, deleting || action === "reload");
    if (action === "reload") {
      if (conflict.operation === "collection") {
        if (unreportedFailure === collectionConflicts.get(conflict.kind)?.error) {
          unreportedFailure = null;
        }
        collectionConflicts.delete(conflict.kind);
        for (const pending of preservedConflicts) {
          itemConflicts.set(itemConflictKey(pending), pending);
        }
      }
      clearConflict(conflict);
      if (hadPendingChanges && domainFor(key)) markDirty(key);
      return null;
    }
    let document = committedConflictCopies.get(conflict);
    if (!document) {
      const id =
        conflict.kind === "theme"
          ? `custom-${makeId()}`
          : conflict.kind === "sourceMix"
            ? `mix-${makeId()}`
            : makeId();
      document = {
        ...conflict.document,
        id,
        ...(typeof conflict.document.name === "string"
          ? { name: `${conflict.document.name} Copy` }
          : {}),
      };
      const result = await invoke("persistence_library_create", {
        kind: conflict.kind,
        id,
        document,
      });
      // The Library commit survives a later Workspace write failure. Retry that step only.
      committedConflictCopies.set(conflict, document);
      const documents = [...(persistedDocuments.get(conflict.kind) || []), document];
      persistedDocuments.set(conflict.kind, clone(documents));
      itemRevisions.get(conflict.kind)?.set(id, result.item.revision);
      collectionRevisions.set(conflict.kind, result.collectionRevision);
      cache.set(key, withCollection(conflict.kind, cache.get(key) || {}, documents));
    }
    const domain = domainFor(key);
    if (domain) await invoke("persistence_save_domain", { domain, value: cache.get(key) });
    notify(key, { origin: "conflict-resolution" });
    clearConflict(conflict);
    return clone(document);
  }

  function updateRefreshTimer() {
    const hasSubscribers = [...subscribers.values()].some((listeners) => listeners.size);
    if (hasSubscribers && !refreshTimer) {
      refreshTimer = setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
    } else if (!hasSubscribers && refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
  }

  return {
    /**
     * @param {string} key
     */
    get(key) {
      const value = cache.get(key);
      return value && typeof value === "object" && !Array.isArray(value) ? value : null;
    },
    /**
     * @param {string} key
     */
    set(key, value) {
      assertWritableSurface(key);
      cache.set(key, clone(value));
      markDirty(key);
    },
    /**
     * @param {string} key
     */
    remove(key) {
      assertWritableSurface(key);
      cache.delete(key);
      markDirty(key);
    },
    /**
     * @param {string} key
     */
    subscribe(key, listener) {
      if (!subscribers.has(key)) subscribers.set(key, new Set());
      subscribers.get(key).add(listener);
      updateRefreshTimer();
      return () => {
        subscribers.get(key)?.delete(listener);
        updateRefreshTimer();
      };
    },
    subscribeLibraryConflicts(listener) {
      conflictSubscribers.add(listener);
      listener(clone(pendingConflict));
      return () => conflictSubscribers.delete(listener);
    },
    /**
     * @param {string} kind
     */
    reportLibraryConflict(kind, document) {
      publishConflict({ kind, id: document?.id ?? null, document: clone(document) });
    },
    establishDevelopmentLibraryConflict(fixtureId, conflict) {
      if (pendingConflict) {
        throw Object.assign(new Error("A library conflict is already pending."), {
          reason: "fixtureConflict",
        });
      }
      publishConflict(
        {
          kind: conflict.kind,
          id: conflict.document?.id ?? null,
          document: clone(conflict.document),
        },
        fixtureId
      );
    },
    matchesDevelopmentLibraryConflict(fixtureId) {
      return pendingConflict !== null && pendingConflictDevelopmentFixtureId === fixtureId;
    },
    resetDevelopmentLibraryConflict(fixtureId) {
      if (pendingConflictDevelopmentFixtureId !== fixtureId) return;
      clearConflict();
    },
    resolveLibraryConflict: resolveConflict,
    refresh,
    flush,
    appendLibrary,
    pauseWrites,
  };
}
