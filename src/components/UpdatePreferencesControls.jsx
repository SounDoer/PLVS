import { useState } from "react";
import { Switch } from "./ui/switch";
import { Button } from "./ui/button";
import { COMPACT_SWITCH_CLASS, COMPACT_SWITCH_THUMB_CLASS } from "./ui/controlStyles.js";

export function UpdatePreferencesControls({
  preferences,
  onChange,
  installationSupported = false,
  disabled = false,
}) {
  return (
    <div className="flex flex-col gap-3 text-[length:var(--ui-fs-control)]">
      <label className="flex items-center justify-between gap-4">
        <span>Automatically Check for Updates</span>
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
      <label className="flex items-center justify-between gap-4">
        <span>Automatically Download Updates</span>
        <Switch
          className={COMPACT_SWITCH_CLASS}
          thumbClassName={COMPACT_SWITCH_THUMB_CLASS}
          aria-label="automatically download updates"
          checked={preferences.autoDownload}
          disabled={disabled || !preferences.autoCheck || !installationSupported}
          onCheckedChange={(autoDownload) => onChange({ autoDownload })}
        />
      </label>
      <p className="text-muted-foreground">
        {installationSupported
          ? "Downloaded updates are offered on your next launch. Installation always asks for confirmation."
          : "This copy requires a manual download from the release page. Automatic installation is unavailable."}
      </p>
    </div>
  );
}

export function UpdatePreferencesSettings({ preferences, onChange, installationSupported }) {
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
    <div className="px-2 py-2">
      <UpdatePreferencesControls
        preferences={preferences}
        onChange={change}
        installationSupported={installationSupported}
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
  busy,
  error,
}) {
  return (
    <>
      <p className="mb-4 text-muted-foreground">
        Choose how PLVS checks for updates. You can change this in Settings.
      </p>
      <UpdatePreferencesControls
        preferences={preferences}
        onChange={onChange}
        installationSupported={installationSupported}
        disabled={busy}
      />
      {error ? (
        <p role="alert" className="mt-2 text-destructive">
          {error}
        </p>
      ) : null}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" disabled={busy} onClick={onSkip}>
          Skip
        </Button>
        <Button disabled={busy} onClick={onSave}>
          Save Preferences
        </Button>
      </div>
    </>
  );
}
