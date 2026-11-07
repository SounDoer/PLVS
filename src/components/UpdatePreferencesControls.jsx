import { useState } from "react";
import { CircleHelp } from "lucide-react";
import { HoverTip } from "./HoverTip.jsx";
import { openExternalUrl, PRIVACY_POLICY_URL } from "../ipc/openExternal.js";
import { LinkButton } from "./ui/link-button";
import { IconAction } from "./ui/icon-action";
import { Switch } from "./ui/switch";
import { Button } from "./ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { INTERFACE_SIZE_OPTIONS } from "../preferences/interfaceSize.js";
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
      ? "Turn on Auto Check for Updates to enable automatic downloads."
      : "Download updates in the background. PLVS asks before installing on the next launch.";
  return (
    <div className="flex flex-col gap-[var(--ui-drawer-row-gap)] text-[length:var(--ui-fs-control)]">
      <label className="flex min-h-[var(--ui-shell-h)] items-center justify-between gap-4 text-muted-foreground">
        <span>Auto Check for Updates</span>
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
      {!installationSupported && installationUnavailableReason ? (
        <p className="max-w-[28rem] text-[length:var(--ui-fs-metric-meta)] text-muted-foreground">
          {installationUnavailableReason}
        </p>
      ) : null}
      <div className="flex min-h-[var(--ui-shell-h)] items-center justify-between gap-4 text-muted-foreground">
        <div className="flex items-center gap-1">
          <span>Auto Download Updates</span>
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
  appearance,
  interfaceSize,
  askToSendCrashReports,
  onAppearanceChange,
  onInterfaceSizeChange,
  onCrashReportChange,
  onChange,
  onSave,
  installationSupported,
  installationUnavailableReason = null,
  onPrivacy = () => openExternalUrl(PRIVACY_POLICY_URL),
  busy,
  error,
}) {
  return (
    <>
      <div className="mt-3 flex flex-col gap-[var(--ui-drawer-row-gap)] text-[length:var(--ui-fs-control)]">
        <div className="flex min-h-[var(--ui-shell-h)] items-center justify-between gap-4 text-muted-foreground">
          <span>Appearance</span>
          <Select value={appearance} onValueChange={onAppearanceChange} disabled={busy}>
            <SelectTrigger aria-label="appearance" variant="flush">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" variant="flush">
              <SelectItem value="system">Follow System</SelectItem>
              <SelectItem value="plvs-light">Light</SelectItem>
              <SelectItem value="plvs-dark">Dark</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex min-h-[var(--ui-shell-h)] items-center justify-between gap-4 text-muted-foreground">
          <span>Interface Size</span>
          <Select value={interfaceSize} onValueChange={onInterfaceSizeChange} disabled={busy}>
            <SelectTrigger aria-label="interface size" variant="flush">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" variant="flush">
              {INTERFACE_SIZE_OPTIONS.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="my-1 border-t border-border" />
        <UpdatePreferencesControls
          preferences={preferences}
          onChange={onChange}
          installationSupported={installationSupported}
          installationUnavailableReason={installationUnavailableReason}
          disabled={busy}
        />
        <div className="flex min-h-[var(--ui-shell-h)] items-center justify-between gap-4 text-muted-foreground">
          <div className="flex items-center gap-1">
            <span>Crash Report Prompt</span>
            <HoverTip
              tip="Saves crash reports locally either way. When enabled, PLVS asks before sending one after a crash."
              side="top"
              className="inline-flex shrink-0"
              tipClassName="w-max max-w-[18rem] whitespace-normal"
            >
              <IconAction aria-label="crash report prompt help" className="p-1">
                <CircleHelp className="size-[1em]" aria-hidden />
              </IconAction>
            </HoverTip>
          </div>
          <Switch
            className={COMPACT_SWITCH_CLASS}
            thumbClassName={COMPACT_SWITCH_THUMB_CLASS}
            aria-label="ask to send crash reports"
            checked={askToSendCrashReports}
            disabled={busy}
            onCheckedChange={onCrashReportChange}
          />
        </div>
      </div>
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
        <Button disabled={busy} onClick={onSave}>
          Continue
        </Button>
      </div>
    </>
  );
}
