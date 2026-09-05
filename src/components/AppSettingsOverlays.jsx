import { useState } from "react";
import { openExternalUrl } from "../ipc/openExternal.js";
import { sliceChangelogSince } from "../lib/changelogAggregate.js";
import { useAgentControlSettings } from "../hooks/useAgentControlSettings.js";
import { useConfigurationProfileActions } from "../hooks/useConfigurationProfileActions.js";
import { FeedbackDialog } from "./FeedbackDialog.jsx";
import { LoudnessProfileEditor } from "./LoudnessProfileEditor.jsx";
import { SettingsPanel } from "./SettingsPanel.jsx";
import { ThemeEditor } from "./ThemeEditor.jsx";
import { UpdateDialog } from "./UpdateDialog.jsx";

export function AppSettingsOverlays({
  settings,
  channelSettings,
  updateControls,
  appVersion,
  loudnessProfile,
  onAgentControlEnabledChange = () => {},
}) {
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false);
  const [selectedUpdate, setSelectedUpdate] = useState(null);
  // Held here, beside the theme editor's position, because both panels are floating overlays this
  // component owns; nothing outside it needs to know where they sit.
  const [loudnessProfilePos, setLoudnessProfilePos] = useState({ x: 120, y: 120 });
  const {
    configurationBusy,
    configurationStatus,
    exportConfiguration,
    importConfiguration,
    resetConfiguration,
  } = useConfigurationProfileActions();
  const { agentControlStatus, agentControlBusy, setAgentControlEnabled } = useAgentControlSettings({
    settingsOpen: settings.settingsOpen,
  });
  const { updateInfo, refreshUpdateCheck, installStatus, install, restartToApply, resetInstall } =
    updateControls;
  const { editor, editorPos, moveEditor } = settings;

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
        themeControlsDisabled={editor.isEditing}
        onExportConfiguration={exportConfiguration}
        onImportConfiguration={importConfiguration}
        onResetConfiguration={resetConfiguration}
        configurationBusy={configurationBusy}
        configurationStatus={configurationStatus}
        agentControlStatus={agentControlStatus}
        agentControlBusy={agentControlBusy}
        onSetAgentControlEnabled={async (next) => {
          const status = await setAgentControlEnabled(next);
          onAgentControlEnabledChange(status?.enabled === true);
        }}
        onOpenFeedback={() => {
          settings.setSettingsOpen(false);
          setFeedbackOpen(true);
        }}
      />

      <UpdateDialog
        open={updateDialogOpen}
        currentVersion={appVersion}
        releaseNotes={selectedUpdate?.releaseNotes}
        installStatus={installStatus}
        onConfirm={() => install(selectedUpdate?.update)}
        onCancel={closeUpdateDialog}
        onRestart={restartToApply}
        openExternalUrl={openExternalUrl}
      />

      {feedbackOpen ? <FeedbackDialog onClose={() => setFeedbackOpen(false)} /> : null}

      {editor.isEditing ? (
        <ThemeEditor
          draft={editor.draft}
          onName={editor.setName}
          onCore={editor.updateCore}
          onPaletteColor={editor.updatePaletteColor}
          onIntensityStop={editor.updateIntensityStop}
          onIntensityStops={editor.updateIntensityStops}
          onApplyPreset={editor.applyPreset}
          onOverride={editor.updateOverride}
          onUndo={editor.undo}
          onRedo={editor.redo}
          canUndo={editor.canUndo}
          canRedo={editor.canRedo}
          canSave={editor.canSave}
          onSave={editor.save}
          onCancel={editor.cancel}
          onDelete={undefined}
          dirty={editor.dirty}
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
          pos={loudnessProfilePos}
          onMove={setLoudnessProfilePos}
        />
      ) : null}
    </>
  );
}
