import { useEffect, useRef, useState } from "react";
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
  const buttonRef = useRef(null);

  const stopRecording = () => {
    setRecording(false);
    setHint("");
    onRecordingChange(false);
    buttonRef.current?.blur();
  };

  const onKeyDown = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") {
      stopRecording();
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
    stopRecording();
  };

  useEffect(() => {
    if (!recording) return;
    // WebViews disagree about whether a clicked button owns keyboard focus.
    // Capture at the window only while the recorder is active, then remove the
    // listener immediately so normal application shortcuts are unaffected.
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [recording, onKeyDown]);

  return (
    <div className="flex flex-col items-end gap-0.5">
      <Button
        ref={buttonRef}
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
        onBlur={stopRecording}
      >
        {recording ? "Press a combo…" : formatAcceleratorForDisplay(value, { isMac })}
      </Button>
      {hint ? (
        <span className="text-[length:var(--ui-fs-axis)] text-destructive">{hint}</span>
      ) : null}
    </div>
  );
}
