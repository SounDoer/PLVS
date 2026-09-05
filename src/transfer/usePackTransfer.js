/// Wiring for per-item import and export: file dialogs, JSON, and the two-step import (parse and
/// plan, then append on confirm). The rules themselves live in `mergeIntoLibrary.js`; this module
/// only sequences them.
///
/// Unlike `useConfigurationProfileActions.js`, failures keep their message: a shared file lands on
/// a machine whose user did not make it, and "Import failed" tells them nothing they can act on.

import { useCallback, useState } from "react";
import { useTransientStatus } from "../hooks/useTransientStatus.js";
import { readProfileFile, writeProfileFile } from "../ipc/commands.js";
import { isTauri } from "../ipc/env.js";
import { pickPackFile, savePackFile } from "../ipc/fileDialog.js";
import { getAdapter } from "./libraryAdapters.js";
import { planPackImport } from "./mergeIntoLibrary.js";
import {
  PackValidationError,
  buildPack,
  packDescriptor,
  parsePack,
  referencedProfileIds,
} from "./packShape.js";

function defaultFileName(descriptor, items) {
  const base = items.length === 1 ? items[0].name : descriptor.defaultBaseName;
  const safe =
    String(base)
      .replace(/[\\/:*?"<>|]/g, "-")
      .trim() || descriptor.defaultBaseName;
  return `${safe}.${descriptor.extension}`;
}

function downloadInBrowser(fileName, contents) {
  const blob = new Blob([contents], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function usePackTransfer() {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useTransientStatus();
  const [review, setReview] = useState(null);

  // No `flushPersistence()` here: unlike `profile.js`'s `exportProfile()`, which round-trips
  // through a Rust command that reads the store file from disk, this hook's reads never leave
  // the in-memory JS store.
  /**
   * @returns {Promise<"written" | "cancelled" | "failed">} what happened, so the caller can decide
   * whether to close its picker. Cancelling the save dialog must not discard the selection: the
   * user was still choosing, and re-checking the same rows to try again is pure busywork.
   */
  const exportSelection = useCallback(
    async (type, selectedIds) => {
      if (busy) return "cancelled";
      setBusy(true);
      setStatus("");
      try {
        const descriptor = packDescriptor(type);
        const chosen = new Set(selectedIds);
        const items = getAdapter(type)
          .list()
          .filter((item) => chosen.has(item.id));

        const options = {};
        if (type === "presets") {
          const wanted = referencedProfileIds(items);
          options.loudnessProfiles = getAdapter("loudness")
            .list()
            .filter((profile) => wanted.has(profile.id));
        }

        const contents = `${JSON.stringify(buildPack(type, items, options), null, 2)}\n`;
        const fileName = defaultFileName(descriptor, items);

        if (!isTauri()) {
          downloadInBrowser(fileName, contents);
          setStatus(`${descriptor.label} exported`);
          return "written";
        }
        const path = await savePackFile(descriptor, fileName);
        if (!path) return "cancelled";
        await writeProfileFile(path, contents);
        setStatus(`${descriptor.label} exported`);
        return "written";
      } catch (error) {
        setStatus(error instanceof PackValidationError ? error.message : "Export failed");
        return "failed";
      } finally {
        setBusy(false);
      }
    },
    [busy]
  );

  const beginImport = useCallback(
    async (type) => {
      if (busy) return;
      setBusy(true);
      setStatus("");
      setReview(null);
      try {
        if (!isTauri()) {
          setStatus("Import is available in the desktop app");
          return;
        }
        const descriptor = packDescriptor(type);
        const path = await pickPackFile(descriptor);
        if (!path) return;

        const text = await readProfileFile(path);
        let raw;
        try {
          raw = JSON.parse(text);
        } catch (_) {
          throw new PackValidationError("This file could not be read.");
        }

        const pack = parsePack(raw, type);
        const planned = planPackImport(type, pack, {
          existingItems: getAdapter(type).list(),
          existingProfiles: type === "presets" ? getAdapter("loudness").list() : [],
        });
        setReview({ type, pack, ...planned });
      } catch (error) {
        // The specific messages cover problems with the file's *contents* -- what a recipient of
        // a shared file actually hits. A filesystem failure here (deleted between picking and
        // reading, permission denied, disk full) is rare, self-explanatory, and its underlying OS
        // string is implementation detail, not user-facing copy, so it falls back to the generic
        // message on purpose rather than by omission.
        setStatus(error instanceof PackValidationError ? error.message : "Import failed");
      } finally {
        setBusy(false);
      }
    },
    [busy]
  );

  const confirmImport = useCallback(() => {
    if (!review) return;
    const { type, profileAdditions, itemAdditions } = review;
    if (profileAdditions.length > 0) getAdapter("loudness").append(profileAdditions);
    getAdapter(type).append(itemAdditions);
    setStatus(`${packDescriptor(type).label} imported`);
    setReview(null);
  }, [review]);

  const cancelImport = useCallback(() => setReview(null), []);

  return { busy, status, review, exportSelection, beginImport, confirmImport, cancelImport };
}
