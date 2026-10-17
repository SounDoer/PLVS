import { useState } from "react";
import { CircleHelp } from "lucide-react";
import { HoverTip } from "./HoverTip.jsx";
import { openExternalUrl, PRIVACY_POLICY_URL } from "../ipc/openExternal.js";
import { LinkButton } from "./ui/link-button";
import { IconAction } from "./ui/icon-action";
import { Switch } from "./ui/switch";
import { Button } from "./ui/button";
import { COMPACT_SWITCH_CLASS, COMPACT_SWITCH_THUMB_CLASS } from "./ui/controlStyles.js";

export function UpdatePreferencesControls({
  preferences,
  onChange,
  installationSupported = false,
  installationUnavailableReason = null,
  disabled = false,
}) {
  const downloadHelp = !installationSupported
    ? (installationUnavailableReason ??
      "Automatic downloads require the installed version of PLVS. Download updates manually from Releases.")
    : !preferences.autoCheck
      ? "Turn on Auto Check to enable automatic downloads."
      : "Download updates in the background. PLVS asks before installing on the next launch.";
  return (
    <div className="flex flex-col gap-[var(--ui-drawer-row-gap)] text-[length:var(--ui-fs-control)]">
      <label className="flex min-h-[var(--ui-shell-h)] items-center justify-between gap-4 text-muted-foreground">
        <span>Auto Check</span>
        <Switch
          className={COMPACT_SWITCH_CLASS}
          thumbClassName={COMPACT_SWITCH_THUMB_CLASS}
          aria-label="automatically check for updates"
          checked={preferences.autoCheck}
          disabled={disabled}
          onCheckedChange={(autoCheck) =>
            onChange({ autoCheck, ...(!autoCheck ? { autoDownload: false } : {}) })
          }
        />
      </label>
      <div className="flex min-h-[var(--ui-shell-h)] items-center justify-between gap-4 text-muted-foreground">
        <div className="flex items-center gap-1">
          <span>Auto Download</span>
          <HoverTip
            tip={downloadHelp}
            side="top"
            align="start"
            className="inline-flex shrink-0"
            tipClassName="w-max max-w-[18rem] whitespace-normal"
          >
            <IconAction aria-label={`auto download help: ${downloadHelp}`} className="p-1">
              <CircleHelp className="size-[1em]" aria-hidden />
            </IconAction>
          </HoverTip>
        </div>
        <Switch
          className={COMPACT_SWITCH_CLASS}
          thumbClassName={COMPACT_SWITCH_THUMB_CLASS}
          aria-label="automatically download updates"
          checked={preferences.autoDownload}
          disabled={disabled || !preferences.autoCheck || !installationSupported}
          onCheckedChange={(autoDownload) => onChange({ autoDownload })}
        />
      </div>
      {!installationSupported && installationUnavailableReason ? (
        <p className="max-w-[28rem] text-[length:var(--ui-fs-metric-meta)] text-muted-foreground">
          {installationUnavailableReason}
        </p>
      ) : null}
    </div>
  );
}

export function UpdatePreferencesSettings({
  preferences,
  onChange,
  installationSupported,
  installationUnavailableReason = null,
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  async function change(patch) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onChange(patch);
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="px-2">
      <UpdatePreferencesControls
        preferences={preferences}
        onChange={change}
        installationSupported={installationSupported}
        installationUnavailableReason={installationUnavailableReason}
        disabled={busy}
      />
      {error ? (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function UpdateSetupContent({
  preferences,
  onChange,
  onSave,
  onSkip,
  installationSupported,
  installationUnavailableReason = null,
  onPrivacy = () => openExternalUrl(PRIVACY_POLICY_URL),
  busy,
  error,
}) {
  return (
    <>
      <p className="mb-3 text-[length:var(--ui-fs-metric-meta)] text-muted-foreground">
        Change anytime in Settings.
      </p>
      <UpdatePreferencesControls
        preferences={preferences}
        onChange={onChange}
        installationSupported={installationSupported}
        installationUnavailableReason={installationUnavailableReason}
        disabled={busy}
      />
      {error ? (
        <p role="alert" className="mt-2 text-[length:var(--ui-fs-control)] text-destructive">
          {error}
        </p>
      ) : null}
      <p className="mt-3 text-[length:var(--ui-fs-metric-meta)] text-muted-foreground">
        <LinkButton className="underline underline-offset-2" onClick={onPrivacy}>
          Privacy Policy
        </LinkButton>
      </p>
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="ghost" disabled={busy} onClick={onSkip}>
          Skip
        </Button>
        <Button disabled={busy} onClick={onSave}>
          Save
        </Button>
      </div>
    </>
  );
}
