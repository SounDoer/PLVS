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
import { pickPackFile, pickSharedPackFile, savePackFile } from "../ipc/fileDialog.js";
import { readClipboardText } from "../ipc/clipboard.js";
import { collectPackItems } from "./collectPackItems.js";
import { getAdapter } from "./libraryAdapters.js";
import { planPackImport } from "./mergeIntoLibrary.js";
import {
  PackValidationError,
  buildPack,
  packDescriptor,
  parseClipboardTheme,
  parsePackText,
  parseSharedPackText,
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
  const [completion, setCompletion] = useState(null);

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
        const { items, options } = collectPackItems(type, [...selectedIds]);

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
    [busy, setStatus]
  );

  const beginImport = useCallback(
    async (type) => {
      if (busy) return;
      setBusy(true);
      setStatus("");
      setReview(null);
      setCompletion(null);
      try {
        if (!isTauri()) {
          setStatus("Import is available in the desktop app");
          return;
        }
        const descriptor = packDescriptor(type);
        const path = await pickPackFile(descriptor);
        if (!path) return;

        const text = await readProfileFile(path);
        const pack = parsePackText(text, type);
        const planned = planPackImport(type, pack, {
          existingItems: getAdapter(type).list(),
          existingProfiles: type === "presets" ? getAdapter("loudness").list() : [],
        });
        setReview({ type, origin: "file", pack, ...planned });
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
    [busy, setStatus]
  );

  const beginSharedImport = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setStatus("");
    setReview(null);
    setCompletion(null);
    try {
      if (!isTauri()) {
        setStatus("Import is available in the desktop app");
        return;
      }
      const path = await pickSharedPackFile();
      if (!path) return;
      const text = await readProfileFile(path);
      const { type, pack } = parseSharedPackText(text);
      const planned = planPackImport(type, pack, {
        existingItems: getAdapter(type).list(),
        existingProfiles: type === "presets" ? getAdapter("loudness").list() : [],
      });
      setReview({ type, origin: "file", pack, ...planned });
    } catch (error) {
      setStatus(error instanceof PackValidationError ? error.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }, [busy, setStatus]);

  const beginThemePaste = useCallback(
    async (text) => {
      if (busy) return;
      setBusy(true);
      setStatus("");
      setReview(null);
      setCompletion(null);
      try {
        let raw;
        try {
          raw = JSON.parse(text);
        } catch (_) {
          throw new PackValidationError("Clipboard doesn't contain a PLVS Theme.");
        }
        const pack = parseClipboardTheme(raw);
        const planned = planPackImport("themes", pack, {
          existingItems: getAdapter("themes").list(),
        });
        setReview({ type: "themes", origin: "clipboard", pack, ...planned });
      } catch (error) {
        setStatus(
          error instanceof PackValidationError
            ? error.message
            : "PLVS couldn't read the clipboard. Use Import to choose a .plvstheme file instead."
        );
      } finally {
        setBusy(false);
      }
    },
    [busy, setStatus]
  );

  const pasteThemeFromClipboard = useCallback(async () => {
    if (busy) return;
    try {
      const text = await readClipboardText();
      await beginThemePaste(text);
    } catch (_) {
      setStatus(
        "PLVS couldn't read the clipboard. Use Import to choose a .plvstheme file instead."
      );
    }
  }, [beginThemePaste, busy, setStatus]);

  const confirmImport = useCallback(() => {
    if (!review) return;
    const { type, profileAdditions, itemAdditions } = review;
    if (profileAdditions.length > 0) getAdapter("loudness").append(profileAdditions);
    getAdapter(type).append(itemAdditions);
    if (review.origin === "clipboard") {
      setStatus(
        itemAdditions.length > 0
          ? "Theme added to your library."
          : "Theme is already in your library."
      );
    } else {
      setStatus(`${packDescriptor(type).label} imported`);
    }
    setCompletion({
      type,
      origin: review.origin,
      itemPlan: review.itemPlan,
    });
    setReview(null);
  }, [review, setStatus]);

  const cancelImport = useCallback(() => setReview(null), []);

  const runCompletionAction = useCallback(
    async (action) => {
      if (!completion || completion.itemPlan.length !== 1 || busy) return false;
      setBusy(true);
      const entry = completion.itemPlan[0];
      try {
        const applied = await action(completion.type, entry.finalId);
        if (applied === false) {
          setStatus(`${entry.name} was imported, but the follow-up action was refused.`);
          return false;
        }
        setCompletion(null);
        return true;
      } catch (error) {
        const reason = error instanceof Error ? ` ${error.message}` : "";
        setStatus(`${entry.name} was imported.${reason}`);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [busy, completion, setStatus]
  );

  const dismissCompletion = useCallback(() => setCompletion(null), []);

  return {
    busy,
    status,
    review,
    completion,
    exportSelection,
    beginImport,
    beginSharedImport,
    beginThemePaste,
    pasteThemeFromClipboard,
    confirmImport,
    cancelImport,
    runCompletionAction,
    dismissCompletion,
  };
}
