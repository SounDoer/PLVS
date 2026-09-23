import { invoke } from "@tauri-apps/api/core";

const FLUSH_DELAY_MS = 200;
const REFRESH_INTERVAL_MS = 1000;
const DOMAIN_KIND = {
  "plvs:presets": "preset",
  "plvs:themes": "theme",
};

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function documentsFor(key, value) {
  if (key === "plvs:presets") return Array.isArray(value?.list) ? value.list : [];
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

function kindFor(key) {
  if (key === "plvs:settings") return "loudnessProfile";
  return DOMAIN_KIND[key] ?? null;
}

function domainFor(key) {
  if (key === "plvs:settings") return "settings";
  if (key === "plvs:workspace") return "workspace";
  if (key === "plvs:presets") return "presets";
  return null;
}

function signature(value) {
  return JSON.stringify(value);
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
    ["plvs:settings", "plvs:workspace", "plvs:presets", "plvs:themes"]
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
  const subscribers = new Map();
  let flushTimer = null;
  let refreshTimer = null;
  let activeDrain = null;
  let activeRefresh = null;
  let unreportedFailure = null;
  let pendingConflict = null;
  const conflictSubscribers = new Set();

  function publishConflict(conflict) {
    pendingConflict = conflict;
    for (const listener of conflictSubscribers) listener(clone(conflict));
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
    } else if (removed.length === 1 && !added.length && !changed.length && !orderChanged) {
      const id = removed[0];
      const collectionRevision = await invoke("persistence_library_delete", {
        kind,
        id,
        expectedRevision: revisions.get(id),
      });
      revisions.delete(id);
      collectionRevisions.set(kind, collectionRevision);
    } else if (!added.length && !removed.length && !changed.length && orderChanged) {
      const collectionRevision = await invoke("persistence_library_reorder", {
        kind,
        orderedIds: nextOrder,
        expectedCollectionRevision: collectionRevisions.get(kind) ?? 0,
      });
      collectionRevisions.set(kind, collectionRevision);
    } else {
      const result = await invoke("persistence_library_replace", {
        kind,
        documents: nextDocuments,
        expectedCollectionRevision: collectionRevisions.get(kind) ?? 0,
        expectedItemRevisions: Object.fromEntries(revisions),
      });
      itemRevisions.set(kind, new Map(result.items.map((item) => [item.id, item.revision])));
      collectionRevisions.set(kind, result.collectionRevision);
    }
    persistedDocuments.set(kind, clone(nextDocuments));
  }

  async function persistGlobalPreferences(values) {
    const changed = Object.fromEntries(
      Object.entries(values).filter(
        ([key, value]) => signature(persistedGlobalPreferences.get(key)) !== signature(value)
      )
    );
    if (!Object.keys(changed).length) return;
    const expectedRevisions = Object.fromEntries(
      Object.keys(changed).map((key) => [key, globalPreferenceRevisions.get(key) ?? 0])
    );
    const revisions = await invoke("persistence_save_global_preferences", {
      values: changed,
      expectedRevisions,
    });
    for (const [key, value] of Object.entries(changed)) persistedGlobalPreferences.set(key, value);
    for (const [key, revision] of Object.entries(revisions))
      globalPreferenceRevisions.set(key, revision);
  }

  async function persistKey(key) {
    const value = cache.get(key) || {};
    if (key === "plvs:settings" && Object.hasOwn(value, "askToSendCrashReports")) {
      await persistGlobalPreferences({ askToSendCrashReports: value.askToSendCrashReports });
    }
    const kind = kindFor(key);
    if (kind) await persistCollection(kind, documentsFor(key, value));
    const domain = domainFor(key);
    if (domain) await invoke("persistence_save_domain", { domain, value });
  }

  async function drain() {
    while (dirty.size) {
      const keys = [...dirty.keys()];
      dirty.clear();
      for (let index = 0; index < keys.length; index += 1) {
        try {
          await persistKey(keys[index]);
        } catch (error) {
          for (const pendingKey of keys.slice(index)) dirty.set(pendingKey, true);
          throw error;
        }
      }
    }
  }

  function ensureDrain() {
    if (!dirty.size) return activeDrain;
    if (activeDrain) return activeDrain;
    const running = drain().catch((error) => {
      unreportedFailure ??= error;
    });
    activeDrain = running;
    running.then(() => {
      if (activeDrain !== running) return;
      activeDrain = null;
      if (dirty.size && !unreportedFailure) ensureDrain();
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

  function notify(key, event) {
    for (const listener of subscribers.get(key) || []) listener(event);
  }

  function applyRemoteCollection(kind, hydrated) {
    const remoteRevision = hydrated.libraryCollectionRevisions?.[kind] ?? 0;
    if (remoteRevision <= (collectionRevisions.get(kind) ?? 0)) return;
    const key =
      kind === "preset" ? "plvs:presets" : kind === "theme" ? "plvs:themes" : "plvs:settings";
    if (dirty.has(key)) return;
    const current = cache.get(key) || {};
    let next;
    if (kind === "preset") {
      next = { ...current, list: hydrated.presets?.list || [] };
    } else if (kind === "theme") {
      next = hydrated.themes || { themes: {}, order: [] };
    } else {
      next = {
        ...current,
        loudnessProfiles: {
          ...(current.loudnessProfiles || {}),
          profiles: hydrated.settings?.loudnessProfiles?.profiles || [],
        },
      };
    }
    cache.set(key, clone(next));
    persistedDocuments.set(kind, clone(documentsFor(key, next)));
    itemRevisions.set(kind, new Map(Object.entries(hydrated.libraryItemRevisions?.[kind] || {})));
    collectionRevisions.set(kind, remoteRevision);
    notify(key, { origin: "remote" });
  }

  async function refresh() {
    if (activeDrain || dirty.size) return;
    if (activeRefresh) return activeRefresh;
    const refreshing = invoke("persistence_hydrate")
      .then((hydrated) => {
        for (const kind of ["preset", "theme", "loudnessProfile"])
          applyRemoteCollection(kind, hydrated);
        const nextGlobals = hydrated.globalPreferences || {};
        if (
          signature(
            [...persistedGlobalPreferences].sort(([left], [right]) => left.localeCompare(right))
          ) !==
          signature(
            Object.entries(nextGlobals).sort(([left], [right]) => left.localeCompare(right))
          )
        ) {
          persistedGlobalPreferences.clear();
          for (const [key, value] of Object.entries(nextGlobals))
            persistedGlobalPreferences.set(key, clone(value));
          globalPreferenceRevisions.clear();
          for (const [key, revision] of Object.entries(hydrated.globalPreferenceRevisions || {}))
            globalPreferenceRevisions.set(key, revision);
          seed.globalPreferences = clone(nextGlobals);
          metadata.globalPreferenceRevisions = clone(hydrated.globalPreferenceRevisions || {});
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

  async function resolveConflict(action, { makeId = () => crypto.randomUUID() } = {}) {
    if (!pendingConflict) return null;
    const conflict = pendingConflict;
    const key =
      conflict.kind === "preset"
        ? "plvs:presets"
        : conflict.kind === "theme"
          ? "plvs:themes"
          : "plvs:settings";
    dirty.delete(key);
    unreportedFailure = null;
    const hydrated = await invoke("persistence_hydrate");
    applyRemoteCollection(conflict.kind, hydrated);
    if (action === "reload") {
      pendingConflict = null;
      for (const listener of conflictSubscribers) listener(null);
      return null;
    }
    if (action !== "copy") throw new Error("Unknown Library conflict action.");
    const id = conflict.kind === "theme" ? `custom-${makeId()}` : makeId();
    const document = {
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
    const documents = [...(persistedDocuments.get(conflict.kind) || []), document];
    persistedDocuments.set(conflict.kind, clone(documents));
    itemRevisions.get(conflict.kind)?.set(id, result.item.revision);
    collectionRevisions.set(conflict.kind, result.collectionRevision);
    const current = cache.get(key) || {};
    if (conflict.kind === "preset") {
      cache.set(key, { ...current, list: documents });
    } else if (conflict.kind === "theme") {
      const themes = Object.fromEntries(documents.map((item) => [item.id, item]));
      cache.set(key, { themes, order: documents.map((item) => item.id) });
    } else {
      cache.set(key, {
        ...current,
        loudnessProfiles: { ...(current.loudnessProfiles || {}), profiles: documents },
      });
    }
    const domain = domainFor(key);
    if (domain) await invoke("persistence_save_domain", { domain, value: cache.get(key) });
    notify(key, { origin: "conflict-resolution" });
    pendingConflict = null;
    for (const listener of conflictSubscribers) listener(null);
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
    get(key) {
      const value = cache.get(key);
      return value && typeof value === "object" && !Array.isArray(value) ? value : null;
    },
    set(key, value) {
      assertWritableSurface(key);
      cache.set(key, clone(value));
      dirty.set(key, true);
      schedule();
    },
    remove(key) {
      assertWritableSurface(key);
      cache.delete(key);
      dirty.set(key, true);
      schedule();
    },
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
    resolveLibraryConflict: resolveConflict,
    refresh,
    async flush() {
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
    },
  };
}
