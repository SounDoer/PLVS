import * as Dialog from "@radix-ui/react-dialog";
import ReactMarkdown from "react-markdown";

const SECONDARY_BUTTON_CLASS =
  "rounded-md px-2 py-0.5 text-[length:var(--ui-fs-control)] text-muted-foreground transition-colors hover:bg-secondary disabled:pointer-events-none disabled:opacity-50";
const PRIMARY_BUTTON_CLASS =
  "rounded-md bg-primary px-2 py-0.5 text-[length:var(--ui-fs-control)] text-primary-foreground transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-60";

export function UpdateDialog({
  open,
  version,
  releaseNotes = "",
  installStatus = "idle",
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
    <Dialog.Root open={open}>
      <Dialog.Portal>
        <Dialog.Overlay
          data-testid="update-overlay"
          className="fixed inset-0 z-50 bg-black/60"
          onClick={handleDismiss}
        />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100vh-2rem)] w-[min(34rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-border bg-card p-3 shadow-xl focus:outline-none"
          onEscapeKeyDown={(event) => {
            event.preventDefault();
            handleDismiss();
          }}
          onInteractOutside={(event) => {
            event.preventDefault();
          }}
        >
          <Dialog.Title className="text-[length:var(--ui-fs-control)] font-semibold text-foreground">
            Update available
          </Dialog.Title>
          <Dialog.Description className="mt-0.5 text-[length:var(--ui-fs-metric-meta)] text-muted-foreground">
            What&apos;s new in v{version}
          </Dialog.Description>

          <div className="my-3 max-h-[50vh] overflow-y-auto rounded-md border border-border/60 bg-background/35 px-3 py-2 text-[length:var(--ui-fs-control)] text-foreground/90 [&_a]:text-primary [&_a]:underline [&_code]:rounded [&_code]:bg-secondary [&_code]:px-1 [&_h2]:mb-1 [&_h2]:mt-3 [&_h2]:font-semibold [&_h3]:mb-1 [&_h3]:mt-3 [&_h3]:font-semibold [&_hr]:my-3 [&_hr]:border-border [&_li]:my-0.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1.5 [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-secondary [&_pre]:p-2 [&_ul]:list-disc [&_ul]:pl-5">
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

          <div className="flex justify-end gap-1.5">
            <button
              type="button"
              disabled={busy}
              onClick={handleDismiss}
              className={SECONDARY_BUTTON_CLASS}
            >
              {restartFailed ? "Close" : "Cancel"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={handlePrimary}
              className={PRIMARY_BUTTON_CLASS}
            >
              {primaryLabel}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
