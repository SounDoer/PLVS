import { useState } from "react";
import { Button } from "@/components/ui/button";
import { keyEventToAccelerator, formatAcceleratorForDisplay } from "@/lib/accelerator.js";
import { DEFAULT_GLOBAL_CLEAR_SHORTCUT } from "@/lib/globalClearPrefs.js";

export function ShortcutCapture({ value, onChange, isMac = false, disabled = false }) {
  const [recording, setRecording] = useState(false);
  const [hint, setHint] = useState("");

  const onKeyDown = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const accel = keyEventToAccelerator(e);
    if (!accel) {
      setHint("Needs a modifier (Ctrl/Alt/Shift)");
      return;
    }
    onChange(accel);
    setHint("");
    setRecording(false);
    e.currentTarget.blur();
  };

  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        aria-label="Global clear shortcut"
        className="font-mono"
        onClick={() => {
          setRecording(true);
          setHint("");
        }}
        onKeyDown={recording ? onKeyDown : undefined}
        onBlur={() => {
          setRecording(false);
          setHint("");
        }}
      >
        {recording ? "Press a combo…" : formatAcceleratorForDisplay(value, { isMac })}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={disabled}
        onClick={() => onChange(DEFAULT_GLOBAL_CLEAR_SHORTCUT)}
      >
        Reset
      </Button>
      {hint ? <span className="text-xs text-destructive">{hint}</span> : null}
    </div>
  );
}
