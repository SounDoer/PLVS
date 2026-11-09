import { UpdateDetailsContent, UpdateDetailsHeader } from "./UpdateDetailsContent.jsx";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useUiSurface } from "../uiNavigation/UiNavigationContext.jsx";

const DETAILS_FIXTURES = {
  event: "update.available",
  tutorial: "tutorial.update-available",
};

export function UpdateDialog({
  open,
  tutorialPreview = false,
  currentVersion,
  targetVersion = null,
  manualDownloadUrl = null,
  releaseNotes = "",
  ready = false,
  installationSupported = true,
  error = null,
  installStatus = "idle",
  downloading = false,
  downloadProgress = null,
  onConfirm,
  onCancel,
  onRestart,
  openExternalUrl,
}) {
  const busy = installStatus === "installing" || installStatus === "restarting";
  function handleDismiss() {
    if (!busy) onCancel();
  }

  useUiSurface({
    active: open,
    kind: "update",
    origin: "event",
    developmentFixture: DETAILS_FIXTURES[tutorialPreview ? "tutorial" : "event"],
    blocking: false,
    busy,
    dismissible: !busy,
    supportedActions: busy ? [] : ["cancel"],
    target: { phase: installStatus },
    onCancel: handleDismiss,
  });

  return (
    <Dialog open={open}>
      <DialogContent
        size="lg"
        overlayProps={{ "data-testid": "update-overlay", onClick: handleDismiss }}
        onEscapeKeyDown={(event) => {
          event.preventDefault();
          handleDismiss();
        }}
        onInteractOutside={(event) => {
          event.preventDefault();
        }}
      >
        <UpdateDetailsHeader
          ready={ready}
          targetVersion={targetVersion}
          currentVersion={currentVersion}
        />

        <UpdateDetailsContent
          releaseNotes={releaseNotes}
          targetVersion={targetVersion}
          manualDownloadUrl={manualDownloadUrl}
          installStatus={installStatus}
          downloading={downloading}
          downloadProgress={downloadProgress}
          ready={ready}
          installationSupported={installationSupported}
          error={error}
          onConfirm={onConfirm}
          onCancel={onCancel}
          onRestart={onRestart}
          openExternalUrl={openExternalUrl}
        />
      </DialogContent>
    </Dialog>
  );
}
