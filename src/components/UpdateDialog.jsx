import { UpdateDetailsContent, UpdateDetailsHeader } from "./UpdateDetailsContent.jsx";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useUiSurface } from "../uiNavigation/UiNavigationContext.jsx";

export function UpdateDialog({
  open,
  currentVersion,
  targetVersion = null,
  releaseNotes = "",
  ready = false,
  installationSupported = true,
  error = null,
  installStatus = "idle",
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
          installStatus={installStatus}
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
