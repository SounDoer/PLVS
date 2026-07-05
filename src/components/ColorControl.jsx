import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import { toEditable, fromEditable } from "../theme/colorIO.js";

/**
 * @param {{ label: string, value: string, onChange: (css: string) => void }} props
 */
export function ColorControl({ label, value, onChange }) {
  const edit = toEditable(value);
  const [hex, setHex] = useState(edit.hex);
  const [alpha, setAlpha] = useState(edit.alpha);

  function emit(nextHex, nextAlpha) {
    setHex(nextHex);
    setAlpha(nextAlpha);
    onChange(fromEditable(nextHex, nextAlpha));
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" aria-label={label} className="flex items-center gap-2 text-left">
          <span
            className="h-5 w-5 rounded border border-border"
            style={{ backgroundColor: value }}
          />
          <span className="text-[length:var(--ui-fs-metric-meta)]">{label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="flex w-56 flex-col gap-2">
        <input
          type="color"
          aria-label={`${label} picker`}
          value={hex}
          onInput={(e) => emit(e.target.value, alpha)}
        />
        <div className="flex items-center gap-2">
          <Label htmlFor={`${label}-hex`}>Hex</Label>
          <input
            id={`${label}-hex`}
            aria-label={`${label} hex`}
            value={hex}
            onInput={(e) => /^#[0-9a-f]{6}$/i.test(e.target.value) && emit(e.target.value, alpha)}
            className="flex-1 rounded border border-input bg-transparent px-2 py-1"
          />
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor={`${label}-alpha`}>Alpha</Label>
          <input
            id={`${label}-alpha`}
            aria-label={`${label} alpha`}
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={alpha}
            onInput={(e) => emit(hex, parseFloat(e.target.value))}
            className="plvs-range flex-1"
            style={{ "--range-pct": `${Math.max(0, Math.min(100, alpha * 100))}%` }}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
