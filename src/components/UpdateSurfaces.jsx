import { useEffect, useState } from "react";
import { useAppLifecycle } from "../hooks/AppLifecycleContext.jsx";
import { useAppSettings } from "../settings/SettingsContext.jsx";
import { useDock } from "../dock/DockContext.jsx";
import { useBlockingEditor } from "../hooks/BlockingEditorsContext.jsx";
import { useCoordinatorRole } from "../lib/runtimeRole.js";
import { sliceChangelogSince } from "../lib/changelogAggregate.js";
import { releaseUrlForVersion } from "../lib/updateController.js";
import { openExternalUrl } from "../ipc/openExternal.js";
import { updateDetailsChoices } from "./UpdateDetailsContent.jsx";
import { UpdateDialog } from "./UpdateDialog.jsx";
import { UpdateSetupContent } from "./UpdatePreferencesControls.jsx";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog";
import { useDockUpdateWindow } from "../dock/useDockUpdateWindow.js";
import { useDockAccessories } from "../dock/DockAccessoriesContext.jsx";
import { useUiSurface } from "../uiNavigation/UiNavigationContext.jsx";
import { useDevelopmentEventFixtureAdapter } from "../dev/DevelopmentEventFixturesContext.jsx";
import { INTERFACE_SIZE_OPTIONS } from "../preferences/interfaceSize.js";

const DEFAULT_SETUP_DRAFT = Object.freeze({ autoCheck: true, autoDownload: false });

export function UpdateSurfaces({ currentVersion }) {
  const { updateControls: updates, crashReportSetting } = useAppLifecycle();
  const settings = useAppSettings();
  const { docked, dockEdge, dockSuspended, exitDockRestoringAttributes } = useDock();
  const coordinator = useCoordinatorRole();
  const { setUpdateGeometry } = useDockAccessories();
  const [draft, setDraft] = useState(DEFAULT_SETUP_DRAFT);
  const [askToSendCrashReports, setAskToSendCrashReports] = useState(crashReportSetting.enabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // A development fixture shows the first-run dialog without clearing the persisted choice.
  const [setupFixtureId, setSetupFixtureId] = useState(null);
  const firstRunSetup = coordinator && updates.enabled && !settings.updatePreferences.choiceMade;
  const setup = firstRunSetup || setupFixtureId !== null;
  useBlockingEditor("updatePreferences", setup);
  function changeAppearance(value) {
    if (busy) return;
    if (value === "system") settings.setAppearanceMode("system");
    else if (["plvs-light", "plvs-dark"].includes(value)) settings.setFixedThemeIdFromPicker(value);
  }
  function changeInterfaceSize(value) {
    if (!busy && INTERFACE_SIZE_OPTIONS.some((option) => option.id === value))
      settings.setInterfaceSize(value);
  }
  async function save() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      // Settle the native crash preference before enabling any automatic update requests.
      await crashReportSetting.setEnabled(askToSendCrashReports);
      await settings.setUpdatePreferences(draft);
      setSetupFixtureId(null);
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(false);
    }
  }
  const releaseNotes = sliceChangelogSince(updates.details?.target.manifest?.notes, currentVersion);
  // A tutorial preview shows what an installed copy offers; the fixture refuses installing anyway.
  const installationShown =
    updates.details?.target.preview === true ? true : updates.installationSupported;
  const payload = {
    key: setup
      ? "setup"
      : updates.details
        ? `details:${updates.details.target.id}:${updates.details.presentation ?? 0}`
        : null,
    kind: setup ? "setup" : "details",
    preferences: draft,
    appearance: settings.appearance === "system" ? "system" : settings.resolvedThemeId,
    askToSendCrashReports,
    interfaceSize: settings.interfaceSize,
    installationSupported: installationShown,
    busy: busy || ["installing", "restarting"].includes(updates.installStatus),
    error: setup ? error : updates.error,
    targetId: updates.details?.target.id,
    targetVersion: updates.details?.target.version,
    manualDownloadUrl:
      updates.details?.origin === "fixture"
        ? null
        : releaseUrlForVersion(updates.details?.target.version),
    currentVersion,
    installationUnavailableReason: updates.installationUnavailableReason,
    ready: updates.details?.staged === true,
    releaseNotes,
    installStatus: updates.installStatus,
    downloading: updates.downloading,
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
      if (type === "welcome-appearance-change") changeAppearance(payload.value);
      if (type === "welcome-interface-size-change") changeInterfaceSize(payload.value);
      if (type === "welcome-crash-report-change" && typeof payload.value === "boolean")
        setAskToSendCrashReports(payload.value);
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
    choices: [
      { id: "save", label: "Save", run: save },
      ...(!firstRunSetup
        ? [{ id: "cancel", label: "Cancel", run: () => setSetupFixtureId(null) }]
        : []),
    ],
    kind: "update",
    origin: "event",
    developmentFixture: "update-preferences.pending",
    blocking: true,
    busy,
    dismissible: !firstRunSetup && !busy,
    supportedActions: firstRunSetup || busy ? [] : ["cancel"],
    target: { phase: "preferences" },
    onCancel: () => {
      if (!firstRunSetup && !busy) setSetupFixtureId(null);
    },
  });
  useUiSurface({
    active: docked && Boolean(updates.details),
    choices: updateDetailsChoices({
      ...payload,
      onConfirm: () => updates.confirmInstall(payload.targetId),
      onRestart: () => updates.confirmInstall(payload.targetId),
      onCancel: updates.dismissDetails,
      openExternalUrl,
    }),
    kind: "update",
    origin: "event",
    developmentFixture: "update.available",
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
  // Tutorial recording: the status entry reports an ordinary-looking update, and View Update Details
  // opens the real dialog for it; installing is refused like any fixture.
  useDevelopmentEventFixtureAdapter("tutorial.update-available", {
    establish: (id) => updates.previewUpdate(id, currentVersion),
    matches: (id) => updates.candidate?.preview === true && updates.candidate.id === id,
    reset: (id) => updates.clearPreview(id),
    canEstablish: () =>
      coordinator &&
      updates.enabled &&
      !updates.candidate &&
      !updates.ready &&
      !updates.details &&
      !payload.busy &&
      !setup,
    canReset: () => !payload.busy,
    settled: (inspection) =>
      inspection.status?.find((item) => item.id === "update" && item.kind === "update"),
  });
  useDevelopmentEventFixtureAdapter("update-preferences.pending", {
    establish: (id) => {
      setDraft(DEFAULT_SETUP_DRAFT);
      setAskToSendCrashReports(crashReportSetting.enabled);
      setError(null);
      setSetupFixtureId(id);
    },
    matches: (id) => setupFixtureId === id,
    reset: (id) => {
      if (setupFixtureId === id) setSetupFixtureId(null);
    },
    canEstablish: () => coordinator && !firstRunSetup && !updates.details && !busy,
    canReset: () => !busy,
    surface: { kind: "update", target: { phase: "preferences" } },
  });
  if (docked) return null;
  return (
    <>
      <Dialog open={setup}>
        <DialogContent
          size="sm"
          className="overflow-y-auto"
          aria-describedby={undefined}
          onEscapeKeyDown={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
        >
          <DialogTitle>Welcome to PLVS</DialogTitle>
          <UpdateSetupContent
            preferences={draft}
            appearance={payload.appearance}
            interfaceSize={settings.interfaceSize}
            askToSendCrashReports={askToSendCrashReports}
            onAppearanceChange={changeAppearance}
            onInterfaceSizeChange={changeInterfaceSize}
            onCrashReportChange={setAskToSendCrashReports}
            onChange={(patch) => setDraft((previous) => ({ ...previous, ...patch }))}
            onSave={() => void save()}
            installationSupported={updates.installationSupported}
            installationUnavailableReason={updates.installationUnavailableReason}
            busy={busy}
            error={error ?? dockWindow.error}
          />
        </DialogContent>
      </Dialog>
      <UpdateDialog
        open={Boolean(updates.details)}
        targetId={payload.key}
        tutorialPreview={updates.details?.target.preview === true}
        currentVersion={currentVersion}
        targetVersion={updates.details?.target.version}
        manualDownloadUrl={
          updates.details?.origin === "fixture"
            ? null
            : releaseUrlForVersion(updates.details?.target.version)
        }
        releaseNotes={releaseNotes}
        ready={updates.details?.staged === true}
        installStatus={updates.installStatus}
        downloading={updates.downloading}
        downloadProgress={updates.downloadProgress}
        onConfirm={() => updates.confirmInstall(payload.targetId)}
        onCancel={updates.dismissDetails}
        onRestart={() => updates.confirmInstall(payload.targetId)}
        installationSupported={installationShown}
        error={updates.error}
        openExternalUrl={openExternalUrl}
      />
    </>
  );
}
