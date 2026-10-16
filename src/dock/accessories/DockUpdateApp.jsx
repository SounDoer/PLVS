import { useEffect, useLayoutEffect, useRef } from "react";
import { useAccessoryClient } from "./useAccessoryClient.js";
import { UpdateDetailsContent } from "../../components/UpdateDetailsContent.jsx";
import { PRIVACY_POLICY_URL } from "../../ipc/openExternal.js";
import { UpdateSetupContent } from "../../components/UpdatePreferencesControls.jsx";

export function DockUpdateApp() {
  const { payload, action } = useAccessoryClient("dock-update");
  const key = payload?.key;
  const rootRef = useRef(null);
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!key || !root) return;
    let lastHeight = 0;
    const measure = () => {
      const height = Math.ceil(root.getBoundingClientRect().height);
      if (height > 0 && height !== lastHeight) {
        lastHeight = height;
        void action("update-resize", { key, height });
      }
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(root);
    return () => observer?.disconnect();
  }, [action, key]);
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
    <div className="max-h-screen overflow-y-auto">
      <main
        ref={rootRef}
        className="rounded-xl border border-border bg-card p-3 text-[length:var(--ui-fs-control)] text-foreground"
        data-dock-update
      >
        <h1 className="font-semibold">
          {payload.kind === "setup"
            ? "Update Preferences"
            : payload.ready
              ? "Update Ready"
              : "Update Available"}
        </h1>
        {payload.kind !== "setup" && payload.targetVersion ? (
          <p className="text-[length:var(--ui-fs-metric-meta)] text-muted-foreground">
            v{payload.targetVersion}
          </p>
        ) : null}
        {payload.kind === "setup" ? (
          <UpdateSetupContent
            preferences={payload.preferences}
            installationUnavailableReason={payload.installationUnavailableReason}
            onPrivacy={() => send("update-link", { url: PRIVACY_POLICY_URL })}
            installationSupported={payload.installationSupported}
            busy={payload.busy}
            error={payload.error}
            onChange={(patch) => send("update-preferences-change", { patch })}
            onSave={() => send("update-preferences-save")}
            onSkip={() => send("update-preferences-skip")}
          />
        ) : (
          <UpdateDetailsContent
            accessory
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
    </div>
  );
}
