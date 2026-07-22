import { useState } from "react";
import { openExternalUrl } from "../ipc/openExternal.js";
import { useCliPathSettings } from "../hooks/useCliPathSettings.js";
import { useConfigurationProfileActions } from "../hooks/useConfigurationProfileActions.js";
import { FeedbackDialog } from "./FeedbackDialog.jsx";
import { SettingsPanel } from "./SettingsPanel.jsx";
import { ThemeEditor } from "./ThemeEditor.jsx";
import { UpdateDialog } from "./UpdateDialog.jsx";

export function AppSettingsOverlays({ settings, channelSettings, updateControls, appVersion }) {
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false);
  const [selectedUpdate, setSelectedUpdate] = useState(null);
  const {
    configurationBusy,
    configurationStatus,
    exportConfiguration,
    importConfiguration,
    resetConfiguration,
  } = useConfigurationProfileActions();
  const { cliPathStatus, cliPathBusy, setCliPathEnabled } = useCliPathSettings({
    settingsOpen: settings.settingsOpen,
  });
  const { updateInfo, refreshUpdateCheck, installStatus, install, restartToApply, resetInstall } =
    updateControls;
  const { editor, editorPos, moveEditor } = settings;

  function openUpdateDialog() {
    resetInstall();
    setSelectedUpdate({
      version: updateInfo?.latestVersion,
      releaseNotes: updateInfo?.releaseNotes,
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
        themeSelectOptions={settings.themeSelectOptions}
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
        clearShortcut={settings.clearShortcut}
        setClearShortcut={settings.setClearShortcut}
        clearGlobal={settings.clearGlobal}
        setClearGlobal={settings.setClearGlobal}
        setClearCapturing={settings.setClearCapturing}
        clearReady={settings.clearReady}
        registrationError={settings.registrationError}
        customThemeOptions={settings.customThemeOptions}
        createCustomTheme={settings.createCustomTheme}
        editActiveCustomTheme={settings.editActiveCustomTheme}
        deleteCustomTheme={settings.deleteCustomTheme}
        activeIsCustom={settings.activeIsCustom}
        themeControlsDisabled={editor.isEditing}
        onExportConfiguration={exportConfiguration}
        onImportConfiguration={importConfiguration}
        onResetConfiguration={resetConfiguration}
        configurationBusy={configurationBusy}
        configurationStatus={configurationStatus}
        cliPathStatus={cliPathStatus}
        cliPathBusy={cliPathBusy}
        onSetCliPathEnabled={setCliPathEnabled}
        onOpenFeedback={() => {
          settings.setSettingsOpen(false);
          setFeedbackOpen(true);
        }}
      />

      <UpdateDialog
        open={updateDialogOpen}
        version={selectedUpdate?.version}
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
          onSeed={editor.updateSeed}
          onShell={editor.updateShell}
          onSave={editor.save}
          onCancel={editor.cancel}
          onDelete={undefined}
          dirty={editor.dirty}
          pos={editorPos}
          onMove={moveEditor}
        />
      ) : null}
    </>
  );
}
