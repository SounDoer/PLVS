import { useEffect, useState } from "react";
import { HexColorPicker } from "react-colorful";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toEditable, fromEditable } from "../theme/colorIO.js";
import { normalizeOpaqueColor } from "../theme/themeColorMath.js";

/**
 * @param {{ label: string, value: string, onChange: (css: string) => void, allowAlpha?: boolean }} props
 */
export function ColorControl({ label, value, onChange, allowAlpha = true }) {
  const edit = toEditable(value);
  const [hex, setHex] = useState(edit.hex);
  const [alpha, setAlpha] = useState(edit.alpha);
  const [colorText, setColorText] = useState(edit.hex);

  useEffect(() => {
    const next = toEditable(value);
    setHex(next.hex);
    setAlpha(next.alpha);
    setColorText(next.hex);
  }, [value]);

  function emit(nextHex, nextAlpha) {
    setHex(nextHex);
    setAlpha(nextAlpha);
    setColorText(nextHex);
    onChange(fromEditable(nextHex, nextAlpha));
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          // Without its own ring this falls back to the UA focus outline, which
          // renders white regardless of the theme and boxes the whole row. The
          // ring is dropped while the panel is open: the trigger keeps focus
          // there, and any keypress -- a bare Shift is enough in Chromium --
          // flips :focus-visible on, framing a row whose panel is already the
          // thing being looked at.
          className="flex items-center gap-2 rounded text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring data-[state=open]:focus-visible:ring-0"
        >
          <span
            className="h-5 w-5 rounded border border-border"
            style={{ backgroundColor: value }}
          />
          <span className="text-[length:var(--ui-fs-metric-meta)]">{label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="flex w-56 flex-col gap-2 p-3">
        <HexColorPicker
          aria-label={`${label} picker`}
          className="plvs-color-picker"
          color={hex}
          onChange={(next) => emit(next, alpha)}
        />
        {allowAlpha ? (
          <input
            aria-label={`${label} alpha`}
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={alpha}
            onInput={(e) => emit(hex, parseFloat(e.target.value))}
            className="plvs-range w-full"
            style={{ "--range-pct": `${Math.max(0, Math.min(100, alpha * 100))}%` }}
          />
        ) : null}
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="size-5 shrink-0 rounded border border-border"
            style={{ backgroundColor: fromEditable(hex, alpha) }}
          />
          <input
            aria-label={`${label} hex`}
            value={colorText}
            onInput={(event) => {
              const raw = event.target.value;
              setColorText(raw);
              const normalized = normalizeOpaqueColor(raw);
              if (normalized) emit(normalized, allowAlpha ? alpha : 1);
            }}
            onBlur={() => setColorText(hex)}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") {
                setColorText(hex);
                event.currentTarget.blur();
              }
            }}
            // `min-w-0` lets the field shrink past a text input's intrinsic width
            // (default `size=20`), which otherwise pushes it out of the popover.
            className="min-w-0 flex-1 rounded border border-input bg-transparent px-2 py-1 text-[length:var(--ui-fs-metric-meta)]"
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
