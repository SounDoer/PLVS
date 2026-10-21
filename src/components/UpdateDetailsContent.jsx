import ReactMarkdown from "react-markdown";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";

/** The same heading and version context in both native hosts. */
export function UpdateDetailsHeader({ ready, targetVersion, currentVersion, accessory = false }) {
  const Title = accessory ? "h1" : DialogTitle;
  const Description = accessory ? "p" : DialogDescription;
  return (
    <>
      <Title className="text-[length:var(--ui-fs-control)] font-semibold text-foreground">
        {ready ? "Update Ready" : "Update Available"}
      </Title>
      <Description className="mt-0 text-[length:var(--ui-fs-metric-meta)] text-muted-foreground">
        {targetVersion ? `v${targetVersion} · ` : ""}
        {currentVersion ? `What's new since v${currentVersion}` : "What's new"}
      </Description>
    </>
  );
}

/** Shared content for the normal dialog and the Dock accessory; owns no update or window state. */
export function UpdateDetailsContent({
  releaseNotes = "",
  targetVersion = null,
  manualDownloadUrl = null,
  accessory = false,
  installStatus = "idle",
  downloading = false,
  downloadProgress = null,
  ready = false,
  installationSupported = true,
  error = null,
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
  const waitingForDownload = downloading && !busy;

  const primaryLabel = restarting
    ? "Restarting..."
    : installing
      ? "Updating..."
      : waitingForDownload
        ? "Downloading..."
        : restartFailed
          ? "Restart"
          : installFailed
            ? "Retry"
            : installationSupported
              ? "Update and Restart"
              : "Download Manually";

  function handlePrimary() {
    if (busy || waitingForDownload) return;
    if (restartFailed) {
      onRestart();
      return;
    }
    onConfirm();
  }

  function handleDismiss() {
    if (!busy) onCancel();
  }

  function handleManualDownload() {
    if (!busy && manualDownloadUrl) void openExternalUrl(manualDownloadUrl);
  }

  return (
    <>
      {" "}
      <div
        style={accessory ? { maxHeight: 320 } : undefined}
        className="my-3 max-h-[50vh] overflow-y-auto rounded-md border border-border bg-background px-3 py-2 text-[length:var(--ui-fs-control)] text-foreground [&_a]:text-primary [&_a]:underline [&_code]:rounded-xs [&_code]:bg-secondary [&_code]:px-1 [&_h2]:mb-1 [&_h2]:mt-3 [&_h2:first-child]:mt-0 [&_h2]:font-semibold [&_h3]:mb-1 [&_h3]:mt-3 [&_h3]:font-semibold [&_hr]:my-3 [&_hr]:border-border [&_li]:my-0 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-secondary [&_pre]:p-2 [&_ul]:list-disc [&_ul]:pl-5"
      >
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
      {installing || waitingForDownload ? <UpdateDownloadBar progress={downloadProgress} /> : null}
      {error ? (
        <p role="alert" className="mb-2 text-destructive">
          {error}
        </p>
      ) : null}
      {installFailed ? (
        <p className="mb-2 text-[length:var(--ui-fs-control)] text-destructive">
          {manualDownloadUrl && targetVersion
            ? `Update failed. Please try again, or download v${targetVersion} manually from GitHub Releases.`
            : "Update failed. Please try again."}
        </p>
      ) : null}
      {restartFailed ? (
        <p className="mb-2 text-[length:var(--ui-fs-control)] text-destructive">
          Update installed. Restart PLVS to finish.
        </p>
      ) : null}
      <DialogFooter className={installFailed && manualDownloadUrl ? "justify-between" : undefined}>
        {installFailed && manualDownloadUrl ? (
          <Button variant="outline" disabled={busy} onClick={handleManualDownload}>
            Download Manually
          </Button>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" disabled={busy} onClick={handleDismiss}>
            {restartFailed ? "Close" : ready ? "Skip This Time" : "Cancel"}
          </Button>
          <Button disabled={busy || waitingForDownload} onClick={handlePrimary}>
            {primaryLabel}
          </Button>
        </div>
      </DialogFooter>
    </>
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
