import ReactMarkdown from "react-markdown";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";

export function UpdateDialog({
  open,
  currentVersion,
  releaseNotes = "",
  installStatus = "idle",
  downloadProgress = null,
  onConfirm,
  onCancel,
  onRestart,
  openExternalUrl,
}) {
  const installing = installStatus === "installing";
  const restarting = installStatus === "restarting";
  const installFailed = installStatus === "install-error";
  const restartFailed = installStatus === "restart-error";
  const busy = installing || restarting;

  const primaryLabel = restarting
    ? "Restarting..."
    : installing
      ? "Updating..."
      : restartFailed
        ? "Restart"
        : installFailed
          ? "Retry"
          : "Update and Restart";

  function handlePrimary() {
    if (busy) return;
    if (restartFailed) {
      onRestart();
      return;
    }
    onConfirm();
  }

  function handleDismiss() {
    if (!busy) onCancel();
  }

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
        <DialogTitle>Update available</DialogTitle>
        <DialogDescription>
          {currentVersion ? `What's new since v${currentVersion}` : "What's new"}
        </DialogDescription>

        <div className="my-3 max-h-[50vh] overflow-y-auto rounded-md border border-border bg-background px-3 py-2 text-[length:var(--ui-fs-control)] text-foreground [&_a]:text-primary [&_a]:underline [&_code]:rounded-xs [&_code]:bg-secondary [&_code]:px-1 [&_h2]:mb-1 [&_h2]:mt-3 [&_h2:first-child]:mt-0 [&_h2]:font-semibold [&_h3]:mb-1 [&_h3]:mt-3 [&_h3]:font-semibold [&_hr]:my-3 [&_hr]:border-border [&_li]:my-0 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-secondary [&_pre]:p-2 [&_ul]:list-disc [&_ul]:pl-5">
          <ReactMarkdown
            components={{
              a: ({ href, children }) => (
                <a
                  href={href}
                  onClick={(event) => {
                    event.preventDefault();
                    void openExternalUrl(href);
                  }}
                >
                  {children}
                </a>
              ),
            }}
          >
            {releaseNotes}
          </ReactMarkdown>
        </div>

        {installing ? <UpdateDownloadBar progress={downloadProgress} /> : null}

        {installFailed ? (
          <p className="mb-2 text-[length:var(--ui-fs-control)] text-destructive">
            Update failed. Please try again.
          </p>
        ) : null}
        {restartFailed ? (
          <p className="mb-2 text-[length:var(--ui-fs-control)] text-destructive">
            Update installed. Restart PLVS to finish.
          </p>
        ) : null}

        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={handleDismiss}>
            {restartFailed ? "Close" : "Cancel"}
          </Button>
          <Button disabled={busy} onClick={handlePrimary}>
            {primaryLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UpdateDownloadBar({ progress }) {
  const determinate = typeof progress === "number" && Number.isFinite(progress);
  const percent = determinate ? Math.round(Math.min(1, Math.max(0, progress)) * 100) : null;

  return (
    <div
      className="mb-3 h-1 overflow-hidden rounded-full bg-muted"
      role="progressbar"
      aria-label="Update download"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent ?? undefined}
    >
      <div
        className={
          determinate
            ? "h-full rounded-full bg-primary"
            : "update-progress-indeterminate h-full w-1/3 rounded-full bg-primary motion-reduce:w-full motion-reduce:opacity-60"
        }
        style={determinate ? { width: `${percent}%` } : undefined}
      />
    </div>
  );
}
