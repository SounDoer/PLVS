import { invoke } from "@tauri-apps/api/core";

const FLUSH_DELAY_MS = 200;
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
  for (const [key, value] of cache) {
    const kind = kindFor(key);
    if (!kind) continue;
    persistedDocuments.set(kind, clone(documentsFor(key, value)));
    itemRevisions.set(kind, new Map(Object.entries(metadata.itemRevisions?.[kind] || {})));
    collectionRevisions.set(kind, metadata.collectionRevisions?.[kind] ?? 0);
  }

  const dirty = new Map();
  let flushTimer = null;
  let activeDrain = null;
  let unreportedFailure = null;

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
      const result = await invoke("persistence_library_update", {
        kind,
        id,
        expectedRevision: revisions.get(id),
        document: nextById.get(id),
      });
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

  async function persistKey(key) {
    const value = cache.get(key) || {};
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
    subscribe() {
      return () => {};
    },
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
