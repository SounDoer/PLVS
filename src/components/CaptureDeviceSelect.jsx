import { useMemo } from "react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Tauri capture device picker: grouped output/input list with stable value when the list refreshes.
 *
 * @param {{
 *   audioDevices: { id: string; label: string; isSystemOutputMonitor?: boolean }[],
 *   value: string,
 *   onValueChange: (id: string) => void,
 *   disabled?: boolean,
 * }} props
 */
export function CaptureDeviceSelect({ audioDevices, value, onValueChange, disabled }) {
  const outputs = useMemo(() => (audioDevices || []).filter((d) => d.isSystemOutputMonitor), [audioDevices]);
  const inputs = useMemo(() => (audioDevices || []).filter((d) => !d.isSystemOutputMonitor), [audioDevices]);
  const allowed = useMemo(() => {
    const s = new Set(["default"]);
    for (const d of audioDevices || []) s.add(d.id);
    return s;
  }, [audioDevices]);
  const safeValue = allowed.has(value) ? value : "default";

  return (
    <div className="flex min-w-0 max-w-[min(22rem,42vw)] flex-1 items-center gap-2">
      <Label htmlFor="capture-device-select" className="text-[length:var(--ui-fs-metric-meta)] text-muted-foreground shrink-0">
        Device
      </Label>
      <Select value={safeValue} onValueChange={onValueChange} disabled={disabled}>
        <SelectTrigger
          id="capture-device-select"
          className="min-h-8 min-w-0 flex-1 text-[length:var(--ui-fs-metric-meta)]"
          aria-label="Capture device"
        >
          <SelectValue placeholder={disabled ? "No devices" : "Select device"} />
        </SelectTrigger>
        <SelectContent position="popper" className="max-w-[min(22rem,90vw)]">
          <SelectItem value="default">Automatic (default system output)</SelectItem>
          {outputs.length ? (
            <SelectGroup>
              <SelectLabel>Output</SelectLabel>
              {outputs.map((d) => (
                <SelectItem key={d.id} value={d.id} className="min-w-0">
                  <span className="truncate">{d.label}</span>
                </SelectItem>
              ))}
            </SelectGroup>
          ) : null}
          {inputs.length ? (
            <SelectGroup>
              <SelectLabel>Input</SelectLabel>
              {inputs.map((d) => (
                <SelectItem key={d.id} value={d.id} className="min-w-0">
                  <span className="truncate">{d.label}</span>
                </SelectItem>
              ))}
            </SelectGroup>
          ) : null}
        </SelectContent>
      </Select>
    </div>
  );
}
