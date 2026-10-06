import { useEffect, useState } from "react";
import { openExternalUrl } from "../ipc/openExternal.js";
import { sliceChangelogSince } from "../lib/changelogAggregate.js";
import { useAgentControlSettings } from "../hooks/useAgentControlSettings.js";
import { useConfigurationProfileActions } from "../hooks/useConfigurationProfileActions.js";
import { getAdapter } from "../transfer/libraryAdapters.js";
import { usePackTransfer } from "../transfer/usePackTransfer.js";
import { FeedbackDialog } from "./FeedbackDialog.jsx";
import { CrashReportDialog } from "./CrashReportDialog.jsx";
import { ItemPickerDialog } from "./ItemPickerDialog.jsx";
import { LibraryExportDialog } from "./LibraryExportDialog.jsx";
import { LoudnessProfileEditor } from "./LoudnessProfileEditor.jsx";
import { SettingsPanel } from "./SettingsPanel.jsx";
import { ThemeEditor } from "./ThemeEditor.jsx";
import { UpdateDialog } from "./UpdateDialog.jsx";
import { LAYER_PRIORITY } from "./ui/layers.js";
import { BUILTIN_THEMES_V2 } from "../theme/builtinThemesV2.js";
import { createUiNavigationError } from "../uiNavigation/uiNavigationModel.js";
import { useUiNavigationTarget, useUiSurface } from "../uiNavigation/UiNavigationContext.jsx";

/**
 * @param {{
 *   settings: ReturnType<typeof import("../hooks/useSettings.js").useSettings>,
 *   channelSettings: { channelCount: number, channelLabelTokens: string[], channelLabelHasOverride: boolean, selectedLayoutId: string, setChannelLayout: (...args: any[]) => any, setChannelLabelToken: (...args: any[]) => any, resetChannelLabels: (...args: any[]) => any },
 *   updateControls: { updateInfo: { status: string, [key: string]: any }, refreshUpdateCheck: (...args: any[]) => any, installStatus: string, downloadProgress: any, install: (...args: any[]) => any, restartToApply: (...args: any[]) => any, resetInstall: (...args: any[]) => any },
 *   appVersion: string,
 *   loudnessProfile: ReturnType<typeof import("../hooks/LoudnessProfileContext.jsx").useLoudnessProfile>,
 *   presets: ReturnType<typeof import("../hooks/usePresets.js").usePresets>,
 *   crashReportSetting: ReturnType<typeof import("../hooks/useCrashReportSetting.js").useCrashReportSetting>,
 *   crashReporting: ReturnType<typeof import("../hooks/useCrashReporting.js").useCrashReporting>,
 *   packTransfer?: ReturnType<typeof import("../transfer/usePackTransfer.js").usePackTransfer>,
 *   onAgentControlEnabledChange?: (...args: any[]) => any,
 * }} props
 */
export function AppSettingsOverlays({
  settings,
  channelSettings,
  updateControls,
  appVersion,
  loudnessProfile,
  presets,
  crashReportSetting,
  crashReporting,
  packTransfer = null,
  onAgentControlEnabledChange = () => {},
}) {
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackDirty, setFeedbackDirty] = useState(false);
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false);
  const [selectedUpdate, setSelectedUpdate] = useState(null);
  // Held here, beside the theme editor's position, because both panels are floating overlays this
  // component owns; nothing outside it needs to know where they sit.
  const [loudnessProfilePos, setLoudnessProfilePos] = useState({ x: 120, y: 120 });
  const [libraryExportOpen, setLibraryExportOpen] = useState(false);
  const {
    configurationBusy,
    configurationStatus,
    exportConfiguration,
    importConfiguration,
    resetConfiguration,
  } = useConfigurationProfileActions();
  const localPack = usePackTransfer();
  const pack = packTransfer ?? localPack;
  const { beginThemePaste } = pack;
  const { agentControlStatus, agentControlBusy, setAgentControlEnabled } = useAgentControlSettings({
    settingsOpen: settings.settingsOpen,
  });
  const {
    updateInfo,
    refreshUpdateCheck,
    installStatus,
    downloadProgress,
    install,
    restartToApply,
    resetInstall,
  } = updateControls;
  const { editor, editorPos, moveEditor } = settings;

  const themeAuthoring = editor.authoring;
  useUiNavigationTarget("themeEditor", {
    blockingEditorId: "theme",
    matches: ({ intent, themeId }) =>
      editor.isEditing &&
      themeAuthoring?.mode === intent &&
      (themeAuthoring?.sourceId ?? null) === (themeId ?? null),
    show: ({ intent, themeId, page }) => {
      const matches =
        editor.isEditing &&
        themeAuthoring?.mode === intent &&
        (themeAuthoring?.sourceId ?? null) === (themeId ?? null);
      if (!matches) {
        if (intent === "create") settings.createCustomTheme();
        else if (intent === "edit") {
          if (!settings.customThemeOptions.some(({ id }) => id === themeId)) {
            throw createUiNavigationError("uiTargetNotFound", {
              kind: "themeEditor",
              themeId,
            });
          }
          settings.editCustomTheme(themeId);
        } else if (intent === "customize") {
          if (!BUILTIN_THEMES_V2[themeId]) {
            throw createUiNavigationError("uiTargetNotFound", {
              kind: "themeEditor",
              themeId,
            });
          }
          settings.customizeBuiltinTheme(themeId);
        } else if (intent === "duplicate") {
          if (!settings.customThemeOptions.some(({ id }) => id === themeId)) {
            throw createUiNavigationError("uiTargetNotFound", {
              kind: "themeEditor",
              themeId,
            });
          }
          settings.duplicateCustomTheme(themeId);
        }
      }
      if (page) editor.setPage(page);
    },
  });
  useUiSurface({
    active: editor.isEditing,
    kind: "themeEditor",
    origin: "navigable",
    blocking: true,
    dirty: editor.dirty,
    stale: editor.stale,
    dismissible: true,
    supportedActions: ["cancel"],
    target: themeAuthoring
      ? {
          intent: themeAuthoring.mode,
          ...(themeAuthoring.sourceId ? { themeId: themeAuthoring.sourceId } : {}),
          draftId: themeAuthoring.draftId,
          page: editor.page,
        }
      : {},
    onCancel: editor.requestDismiss,
  });

  const profileAuthoring = loudnessProfile?.draft?.authoring;
  useUiNavigationTarget("loudnessProfileEditor", {
    blockingEditorId: "loudnessProfile",
    matches: ({ intent, profileId }) =>
      loudnessProfile?.draft != null &&
      profileAuthoring?.mode === intent &&
      (profileAuthoring?.sourceId ?? null) === (profileId ?? null),
    show: ({ intent, profileId }) => {
      const matches =
        loudnessProfile?.draft != null &&
        profileAuthoring?.mode === intent &&
        (profileAuthoring?.sourceId ?? null) === (profileId ?? null);
      if (matches) return;
      if (intent === "create") loudnessProfile.beginCreate();
      else {
        if (!loudnessProfile.profiles.some(({ id }) => id === profileId)) {
          throw createUiNavigationError("uiTargetNotFound", {
            kind: "loudnessProfileEditor",
            profileId,
          });
        }
        loudnessProfile.beginEdit(profileId);
      }
    },
  });
  useUiSurface({
    active: loudnessProfile?.draft != null,
    kind: "loudnessProfileEditor",
    origin: "navigable",
    blocking: true,
    dirty: loudnessProfile?.draft?.dirty,
    stale: loudnessProfile?.draft?.stale,
    dismissible: true,
    supportedActions: ["cancel"],
    target: profileAuthoring
      ? {
          intent: profileAuthoring.mode,
          ...(profileAuthoring.sourceId ? { profileId: profileAuthoring.sourceId } : {}),
          draftId: profileAuthoring.draftId,
        }
      : {},
    onCancel: loudnessProfile?.requestDismiss,
  });

  useEffect(() => {
    const onPaste = (event) => {
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable
      ) {
        return;
      }
      const text = event.clipboardData?.getData("text/plain");
      if (!text) return;
      event.preventDefault();
      void beginThemePaste(text);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [beginThemePaste]);

  function openUpdateDialog() {
    resetInstall();
    setSelectedUpdate({
      releaseNotes: sliceChangelogSince(updateInfo?.releaseNotes, appVersion),
      update: updateInfo?.update,
    });
    setUpdateDialogOpen(true);
  }

  function closeUpdateDialog() {
    resetInstall();
    setUpdateDialogOpen(false);
    setSelectedUpdate(null);
  }

  function openFeedback() {
    settings.setSettingsOpen(false);
    setFeedbackOpen(true);
  }

  function cancelFeedback() {
    setFeedbackOpen(false);
    setFeedbackDirty(false);
  }

  useUiNavigationTarget("feedback", {
    blockingEditorId: "feedback",
    matches: () => feedbackOpen,
    show: openFeedback,
  });
  useUiSurface({
    active: feedbackOpen,
    kind: "feedback",
    origin: "navigable",
    blocking: true,
    dirty: feedbackDirty,
    dismissible: true,
    supportedActions: ["cancel"],
    target: { phase: "editing" },
    onCancel: cancelFeedback,
  });

  return (
    <>
      <SettingsPanel
        settingsOpen={settings.settingsOpen}
        setSettingsOpen={settings.setSettingsOpen}
        appearance={settings.appearance}
        setAppearanceMode={settings.setAppearanceMode}
        interfaceSize={settings.interfaceSize}
        setInterfaceSize={settings.setInterfaceSize}
        fixedThemeSelectValue={settings.fixedThemeSelectValue}
        setFixedThemeIdFromPicker={settings.setFixedThemeIdFromPicker}
        channelCount={channelSettings.channelCount}
        channelLabelTokens={channelSettings.channelLabelTokens}
        channelLabelHasOverride={channelSettings.channelLabelHasOverride}
        selectedLayoutId={channelSettings.selectedLayoutId}
        setChannelLayout={channelSettings.setChannelLayout}
        setChannelLabelToken={channelSettings.setChannelLabelToken}
        resetChannelLabels={channelSettings.resetChannelLabels}
        appVersion={appVersion}
        latestVersion={updateInfo?.latestVersion}
        releaseUrl={updateInfo?.releaseUrl}
        hasUpdate={updateInfo?.hasUpdate}
        updateStatus={updateInfo?.status}
        onCheckForUpdate={refreshUpdateCheck}
        onInstallUpdate={openUpdateDialog}
        openExternalUrl={openExternalUrl}
        autostartEnabled={settings.autostartEnabled}
        setAutostartEnabled={settings.setAutostartEnabled}
        autostartReady={settings.autostartReady}
        closeAction={settings.closeAction}
        setCloseAction={settings.setCloseAction}
        historyRetentionSec={settings.historyRetentionSec}
        setHistoryRetentionSec={settings.setHistoryRetentionSec}
        dialogueVadEngine={settings.dialogueVadEngine}
        setDialogueVadEngine={settings.setDialogueVadEngine}
        clearShortcut={settings.clearShortcut}
        setClearShortcut={settings.setClearShortcut}
        clearGlobal={settings.clearGlobal}
        setClearGlobal={settings.setClearGlobal}
        setClearCapturing={settings.setClearCapturing}
        clearReady={settings.clearReady}
        registrationError={settings.registrationError}
        customThemeOptions={settings.customThemeOptions}
        createCustomTheme={settings.createCustomTheme}
        editCustomTheme={settings.editCustomTheme}
        customizeBuiltinTheme={settings.customizeBuiltinTheme}
        duplicateCustomTheme={settings.duplicateCustomTheme}
        deleteCustomTheme={settings.deleteCustomTheme}
        onExportTheme={(id) => pack.exportSelection("themes", [id])}
        themeControlsDisabled={editor.isEditing}
        onExportConfiguration={exportConfiguration}
        onImportConfiguration={importConfiguration}
        onResetConfiguration={resetConfiguration}
        configurationBusy={configurationBusy}
        configurationStatus={configurationStatus}
        onLibraryExport={() => setLibraryExportOpen(true)}
        onSharedPackImport={pack.beginSharedImport}
        packBusy={pack.busy}
        packStatus={pack.status}
        agentControlStatus={agentControlStatus}
        agentControlBusy={agentControlBusy}
        onSetAgentControlEnabled={async (next) => {
          const status = await setAgentControlEnabled(next);
          onAgentControlEnabledChange(status?.enabled === true);
        }}
        askToSendCrashReports={crashReportSetting.enabled}
        crashReportSettingBusy={crashReportSetting.busy}
        crashReportSettingError={crashReportSetting.error}
        onAskToSendCrashReports={crashReportSetting.setEnabled}
        onOpenFeedback={openFeedback}
      />

      <UpdateDialog
        open={updateDialogOpen}
        currentVersion={appVersion}
        releaseNotes={selectedUpdate?.releaseNotes}
        installStatus={installStatus}
        downloadProgress={downloadProgress}
        onConfirm={() => install(selectedUpdate?.update)}
        onCancel={closeUpdateDialog}
        onRestart={restartToApply}
        openExternalUrl={openExternalUrl}
      />

      {feedbackOpen ? (
        <FeedbackDialog onClose={cancelFeedback} onDirtyChange={setFeedbackDirty} />
      ) : null}

      {crashReporting.pendingReport ? (
        <CrashReportDialog
          report={crashReporting.pendingReport}
          onClose={crashReporting.dismissPending}
          onDisableAsking={() => crashReportSetting.setEnabled(false)}
        />
      ) : null}

      <LibraryExportDialog
        open={libraryExportOpen}
        itemsByType={{
          loudness: getAdapter("loudness").list(),
          presets: getAdapter("presets").list(),
          themes: getAdapter("themes").list(),
        }}
        dependenciesByType={{ presets: getAdapter("loudness").list() }}
        onExport={pack.exportSelection}
        onClose={() => setLibraryExportOpen(false)}
      />

      {pack.review ? (
        <ItemPickerDialog
          open
          mode="review"
          type={pack.review.type}
          review={pack.review}
          onConfirm={pack.confirmImport}
          onClose={pack.cancelImport}
        />
      ) : null}

      {pack.completion ? (
        <ItemPickerDialog
          open
          mode="complete"
          type={pack.completion.type}
          review={pack.completion}
          onAction={() =>
            pack.runCompletionAction(async (type, id) => {
              if (type === "themes") {
                settings.setFixedThemeIdFromPicker(id);
                return true;
              }
              if (type === "loudness") {
                if (loudnessProfile.draftBlocksLibraryActions) return false;
                loudnessProfile.select(`profile:${id}`);
                return true;
              }
              return presets.apply(id);
            })
          }
          onClose={pack.dismissCompletion}
        />
      ) : null}

      {!settings.settingsOpen && pack.status ? (
        <div
          role="status"
          className={`fixed bottom-4 left-1/2 ${LAYER_PRIORITY} -translate-x-1/2 rounded-md border border-border bg-popover px-3 py-2 text-[length:var(--ui-fs-control)] text-popover-foreground shadow-raised`}
        >
          {pack.status}
        </div>
      ) : null}

      {editor.isEditing ? (
        <ThemeEditor
          draft={editor.draft}
          onName={editor.setName}
          onColorScheme={editor.updateColorScheme}
          onCore={editor.updateCore}
          onResetCore={editor.resetCore}
          onPaletteColor={editor.updatePaletteColor}
          onIntensityStop={editor.updateIntensityStop}
          onIntensityStops={editor.updateIntensityStops}
          onApplyPreset={editor.applyPreset}
          onOverride={editor.updateOverride}
          onResetOverrides={editor.resetOverrides}
          onUndo={editor.undo}
          onRedo={editor.redo}
          canUndo={editor.canUndo}
          canRedo={editor.canRedo}
          canSave={editor.canSave}
          onSave={editor.save}
          onCancel={editor.cancel}
          onDismiss={editor.requestDismiss}
          discardOpen={editor.discardOpen}
          onDiscardOpenChange={(open) => (open ? editor.requestDismiss() : editor.keepEditing())}
          onConfirmDiscard={editor.confirmDiscard}
          page={editor.page}
          onPageChange={editor.setPage}
          onDelete={undefined}
          dirty={editor.dirty}
          stale={editor.stale}
          pos={editorPos}
          onMove={moveEditor}
        />
      ) : null}

      {loudnessProfile?.draft ? (
        <LoudnessProfileEditor
          draft={loudnessProfile.draft}
          onEdit={loudnessProfile.editDraft}
          onSave={loudnessProfile.saveDraft}
          onCancel={loudnessProfile.cancelDraft}
          onDismiss={loudnessProfile.requestDismiss}
          discardOpen={loudnessProfile.discardOpen}
          onDiscardOpenChange={(open) =>
            open ? loudnessProfile.requestDismiss() : loudnessProfile.keepEditing()
          }
          onConfirmDiscard={loudnessProfile.confirmDiscard}
          pos={loudnessProfilePos}
          onMove={setLoudnessProfilePos}
        />
      ) : null}
    </>
  );
}
