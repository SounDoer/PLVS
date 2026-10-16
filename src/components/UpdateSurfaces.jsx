import { useEffect, useState } from "react";
import { useAppLifecycle } from "../hooks/AppLifecycleContext.jsx";
import { useAppSettings } from "../settings/SettingsContext.jsx";
import { useDock } from "../dock/DockContext.jsx";
import { useBlockingEditor } from "../hooks/BlockingEditorsContext.jsx";
import { useCoordinatorRole } from "../lib/runtimeRole.js";
import { sliceChangelogSince } from "../lib/changelogAggregate.js";
import { openExternalUrl } from "../ipc/openExternal.js";
import { UpdateDialog } from "./UpdateDialog.jsx";
import { UpdateSetupContent } from "./UpdatePreferencesControls.jsx";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog";
import { useDockUpdateWindow } from "../dock/useDockUpdateWindow.js";
import { useDockAccessories } from "../dock/DockAccessoriesContext.jsx";
import { useUiSurface } from "../uiNavigation/UiNavigationContext.jsx";
import { useDevelopmentEventFixtureAdapter } from "../dev/DevelopmentEventFixturesContext.jsx";

export function UpdateSurfaces({ currentVersion }) {
  const { updateControls: updates } = useAppLifecycle();
  const settings = useAppSettings();
  const { docked, dockEdge, dockSuspended, exitDockRestoringAttributes } = useDock();
  const coordinator = useCoordinatorRole();
  const { setUpdateGeometry } = useDockAccessories();
  const [draft, setDraft] = useState({ autoCheck: true, autoDownload: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const setup = coordinator && updates.enabled && !settings.updatePreferences.choiceMade;
  useBlockingEditor("updatePreferences", setup);
  async function save(skip = false) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await settings.setUpdatePreferences(skip ? { autoCheck: false, autoDownload: false } : draft);
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(false);
    }
  }
  const releaseNotes = sliceChangelogSince(updates.details?.target.manifest?.notes, currentVersion);
  const payload = {
    key: setup
      ? "setup"
      : updates.details
        ? `details:${updates.details.target.id}:${updates.details.presentation ?? 0}`
        : null,
    kind: setup ? "setup" : "details",
    preferences: draft,
    interfaceSize: settings.interfaceSize,
    installationSupported: updates.installationSupported,
    busy: busy || ["installing", "restarting"].includes(updates.installStatus),
    error: setup ? error : updates.error,
    targetId: updates.details?.target.id,
    targetVersion: updates.details?.target.version,
    currentVersion,
    installationUnavailableReason: updates.installationUnavailableReason,
    ready: updates.details?.staged === true,
    releaseNotes,
    installStatus: updates.installStatus,
    downloadProgress: updates.downloadProgress,
  };
  const dockWindow = useDockUpdateWindow({
    onGeometry: setUpdateGeometry,
    active: docked && !dockSuspended && Boolean(payload.key),
    prepare: docked && (Boolean(payload.key) || updates.updateInfo.hasUpdate === true),
    edge: dockEdge,
    payload,
    onAction: ({ type, payload }) => {
      if (type === "update-confirm") void updates.confirmInstall(payload.targetId);
      if (type === "update-dismiss") updates.dismissDetails();
      if (type === "update-link" && typeof payload.url === "string")
        void openExternalUrl(payload.url);
      if (!setup || busy) return;
      if (type === "update-preferences-change") {
        const patch = payload.patch;
        if (typeof patch?.autoCheck === "boolean")
          setDraft((previous) => ({
            ...previous,
            autoCheck: patch.autoCheck,
            ...(!patch.autoCheck ? { autoDownload: false } : {}),
          }));
        if (typeof patch?.autoDownload === "boolean" && updates.installationSupported)
          setDraft((previous) => ({
            ...previous,
            autoDownload: previous.autoCheck && patch.autoDownload,
          }));
      }
      if (type === "update-preferences-save") void save();
      if (type === "update-preferences-skip") void save(true);
    },
  });
  useEffect(() => {
    if (docked && payload.key && dockWindow.error) {
      // Preserve the owner's draft/target and expose it through the normal host if the
      // native accessory cannot open. Returning from Dock does not discard an editor.
      void exitDockRestoringAttributes();
    }
  }, [docked, payload.key, dockWindow.error, exitDockRestoringAttributes]);
  useUiSurface({
    active: setup,
    kind: "update",
    origin: "event",
    blocking: true,
    busy,
    dismissible: !busy,
    supportedActions: busy ? [] : ["cancel"],
    target: { phase: "preferences" },
    onCancel: () => save(true),
  });
  useUiSurface({
    active: docked && Boolean(updates.details),
    kind: "update",
    origin: "event",
    lifetimeKey: updates.details?.target.id,
    blocking: false,
    busy: payload.busy,
    dismissible: !payload.busy,
    supportedActions: payload.busy ? [] : ["cancel"],
    target: { phase: updates.installStatus },
    onCancel: updates.dismissDetails,
  });
  useDevelopmentEventFixtureAdapter("update.available", {
    establish: updates.openFixture,
    matches: (id) => updates.details?.origin === "fixture" && updates.details.target.id === id,
    reset: (id) => {
      if (updates.details?.origin === "fixture" && updates.details.target.id === id)
        updates.dismissDetails();
    },
    canEstablish: () => coordinator && !payload.busy && !setup,
    canReset: () => !payload.busy,
    surface: { kind: "update", target: { phase: "idle" } },
  });
  if (docked) return null;
  return (
    <>
      <Dialog open={setup}>
        <DialogContent
          size="custom"
          className="w-max max-w-[min(24rem,calc(100vw-2rem))]"
          onEscapeKeyDown={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
        >
          <DialogTitle>Update Preferences</DialogTitle>
          <UpdateSetupContent
            preferences={draft}
            onChange={(patch) => setDraft((previous) => ({ ...previous, ...patch }))}
            onSave={() => void save()}
            onSkip={() => void save(true)}
            installationSupported={updates.installationSupported}
            installationUnavailableReason={updates.installationUnavailableReason}
            busy={busy}
            error={error ?? dockWindow.error}
          />
        </DialogContent>
      </Dialog>
      <UpdateDialog
        open={Boolean(updates.details)}
        currentVersion={currentVersion}
        targetVersion={updates.details?.target.version}
        releaseNotes={releaseNotes}
        ready={updates.details?.staged === true}
        installStatus={updates.installStatus}
        downloadProgress={updates.downloadProgress}
        onConfirm={() => void updates.confirmInstall()}
        onCancel={updates.dismissDetails}
        onRestart={() => void updates.confirmInstall()}
        installationSupported={updates.installationSupported}
        error={updates.error}
        openExternalUrl={openExternalUrl}
      />
    </>
  );
}
