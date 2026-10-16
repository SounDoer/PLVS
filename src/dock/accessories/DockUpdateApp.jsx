import { useEffect } from "react";
import { useAccessoryClient } from "./useAccessoryClient.js";
import { UpdateDetailsContent } from "../../components/UpdateDetailsContent.jsx";
import { UpdateSetupContent } from "../../components/UpdatePreferencesControls.jsx";

export function DockUpdateApp() {
  const { payload, action } = useAccessoryClient("dock-update");
  const key = payload?.key;
  useEffect(() => {
    if (key) void action("update-ready", { key });
  }, [action, key]);
  useEffect(() => {
    const escape = (event) => {
      if (event.key === "Escape" && payload?.kind === "details" && !payload?.busy) {
        void action("update-dismiss", { key });
      }
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [action, key, payload?.busy, payload?.kind]);
  if (!payload?.key) return null;
  const send = (type, extra = {}) => void action(type, { key, ...extra });
  return (
    <main
      className="h-screen overflow-auto rounded-md border border-border bg-card p-5 text-foreground"
      data-dock-update
    >
      <h1 className="mb-3 text-lg font-semibold">
        {payload.kind === "setup"
          ? "Update Preferences"
          : payload.ready
            ? "Update Ready"
            : "Update Available"}
      </h1>
      {payload.kind === "setup" ? (
        <UpdateSetupContent
          preferences={payload.preferences}
          installationSupported={payload.installationSupported}
          busy={payload.busy}
          error={payload.error}
          onChange={(patch) => send("update-preferences-change", { patch })}
          onSave={() => send("update-preferences-save")}
          onSkip={() => send("update-preferences-skip")}
        />
      ) : (
        <UpdateDetailsContent
          releaseNotes={payload.releaseNotes}
          ready={payload.ready}
          installationSupported={payload.installationSupported}
          installStatus={payload.installStatus}
          downloadProgress={payload.downloadProgress}
          error={payload.error}
          onConfirm={() => send("update-confirm", { targetId: payload.targetId })}
          onRestart={() => send("update-confirm", { targetId: payload.targetId })}
          onCancel={() => send("update-dismiss")}
          openExternalUrl={(url) => send("update-link", { url })}
        />
      )}
    </main>
  );
}
