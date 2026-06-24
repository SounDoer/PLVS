import { useState } from "react";
import { Button } from "@/components/ui/button";
import { keyEventToAccelerator, formatAcceleratorForDisplay } from "@/lib/accelerator.js";
import { reservedComboConflict } from "@/data/keyboardShortcuts.js";

export function ShortcutCapture({
  value,
  onChange,
  isMac = false,
  disabled = false,
  onRecordingChange = () => {},
}) {
  const [recording, setRecording] = useState(false);
  const [hint, setHint] = useState("");

  const stopRecording = (el) => {
    setRecording(false);
    setHint("");
    onRecordingChange(false);
    el?.blur();
  };

  const onKeyDown = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") {
      stopRecording(e.currentTarget);
      return;
    }
    const accel = keyEventToAccelerator(e);
    if (!accel) {
      setHint("Needs a modifier (Ctrl/Alt/Shift)");
      return;
    }
    const conflict = reservedComboConflict(accel);
    if (conflict) {
      setHint(`Used by ${conflict}`);
      return;
    }
    onChange(accel);
    stopRecording(e.currentTarget);
  };

  return (
    <div className="flex flex-col items-end gap-0.5">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        aria-label="Clear shortcut"
        className="h-6 font-mono"
        onClick={() => {
          setRecording(true);
          setHint("");
          onRecordingChange(true);
        }}
        onKeyDown={recording ? onKeyDown : undefined}
        onBlur={(e) => stopRecording(e.currentTarget)}
      >
        {recording ? "Press a combo…" : formatAcceleratorForDisplay(value, { isMac })}
      </Button>
      {hint ? <span className="text-[11px] text-destructive">{hint}</span> : null}
    </div>
  );
}
