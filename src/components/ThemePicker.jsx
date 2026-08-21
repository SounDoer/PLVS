import { Check, ChevronDown, Copy, SlidersHorizontal, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { AddButton } from "./AddButton.jsx";
import { IconButton } from "./IconButton.jsx";
import { InlineConfirm } from "./InlineConfirm.jsx";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover.jsx";
import { BUILTIN_THEMES_V2 } from "../theme/builtinThemesV2.js";

/**
 * A miniature of the app rather than a row of chips: workspace behind a surface
 * panel, the text color as a sample on it, and the three data colors as marks.
 *
 * Every core color gets a fixed place, so two roles holding the same value read
 * as two marks of the same color instead of merging into one wider band -- which
 * is what the equal-width strip did, leaving both builtins looking like three
 * uneven segments when they were five equal ones. It also puts the text color
 * on screen, the one core choice the strip left out and the one that answers
 * whether a theme is readable at all.
 *
 * Sized in em so it grows with the row it sits in at every Interface Size.
 */
function ThemeSwatch({ theme }) {
  const { workspace, surface, text, interfaceAccent, primaryData, secondaryData } = theme.core;
  return (
    <span
      aria-hidden="true"
      className="flex h-[1.5em] w-[3.2em] shrink-0 items-center justify-center rounded-xs border border-border"
      style={{ backgroundColor: workspace }}
    >
      <span
        className="flex h-[1.05em] w-[2.7em] items-center gap-[0.15em] rounded-xs px-[0.2em]"
        style={{ backgroundColor: surface }}
      >
        <span className="text-[0.6em] font-semibold leading-none" style={{ color: text }}>
          Aa
        </span>
        <span className="ml-auto flex items-center gap-[0.13em]">
          {[interfaceAccent, primaryData, secondaryData].map((color, index) => (
            <span
              key={`${color}-${index}`}
              className="h-[0.5em] w-[0.22em] rounded-full"
              style={{ backgroundColor: color }}
            />
          ))}
        </span>
      </span>
    </span>
  );
}

/**
 * `label` names the row it belongs to, so screen readers can tell one row's
 * actions from the next. The tooltip says only the verb: it appears next to the
 * row it acts on, and repeating the theme name there just makes it long.
 */
function Action({ label, tip, icon, onClick }) {
  return (
    <IconButton
      aria-label={label}
      tip={tip}
      tipSide="left"
      icon={icon}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick();
      }}
      onMouseDown={(event) => event.preventDefault()}
      className="size-6"
    />
  );
}

function ThemeRow({ theme, selected, onSelect, actions }) {
  return (
    <div className="flex min-h-8 items-center gap-1 rounded-xs px-1 hover:bg-muted/50">
      <button
        type="button"
        onClick={() => onSelect(theme.id)}
        className="flex min-w-0 flex-1 items-center gap-2 text-left text-[length:var(--ui-fs-display)]"
      >
        <span className="flex size-4 items-center justify-center">
          {selected ? <Check className="size-[length:var(--ui-icon-management-action)]" /> : null}
        </span>
        <ThemeSwatch theme={theme} />
        <span className="min-w-0 flex-1 truncate">{theme.name}</span>
      </button>
      <div className="flex shrink-0 items-center">{actions}</div>
    </div>
  );
}

export function ThemePicker({
  value,
  customThemes,
  onSelect,
  onCustomize,
  onEdit,
  onDuplicate,
  onDelete,
  onCreate,
  disabled = false,
}) {
  const [open, setOpen] = useState(false);
  const confirmingDeleteRef = useRef(false);
  const builtins = Object.values(BUILTIN_THEMES_V2);
  const selected =
    builtins.find((theme) => theme.id === value) ??
    customThemes.find((theme) => theme.id === value);

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && confirmingDeleteRef.current) return;
        setOpen(nextOpen);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Theme"
          disabled={disabled}
          className="flex min-h-6 items-center gap-2 rounded-md border border-transparent bg-transparent px-2 py-0.5 text-[length:var(--ui-fs-display)] hover:border-border hover:bg-muted/50 disabled:opacity-40"
        >
          {selected ? <ThemeSwatch theme={selected} /> : null}
          <span>{selected?.name ?? "Theme"}</span>
          <ChevronDown className="size-[1.15em] shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      {/* Sized to the names it holds, capped at the width it used to be fixed at:
          three short built-in names left a gap between them and the row actions
          wide enough to read as two separate columns. Long names still truncate. */}
      <PopoverContent align="end" className="w-auto max-w-72 min-w-44 p-1">
        <div className="px-2 py-1 text-[length:var(--ui-fs-metric-meta)] font-semibold text-muted-foreground">
          Built-in
        </div>
        {builtins.map((theme) => (
          <ThemeRow
            key={theme.id}
            theme={theme}
            selected={value === theme.id}
            onSelect={(id) => {
              setOpen(false);
              onSelect(id);
            }}
            actions={
              <Action
                label={`Customize ${theme.name}`}
                tip="Customize"
                icon={<Copy className="size-[length:var(--ui-icon-management-action)]" />}
                onClick={() => onCustomize(theme.id)}
              />
            }
          />
        ))}
        <div className="mt-1 border-t border-border px-2 pb-1 pt-2 text-[length:var(--ui-fs-metric-meta)] font-semibold text-muted-foreground">
          Custom
        </div>
        {customThemes.map((theme) => (
          <ThemeRow
            key={theme.id}
            theme={theme}
            selected={value === theme.id}
            onSelect={(id) => {
              setOpen(false);
              onSelect(id);
            }}
            actions={
              <>
                <Action
                  label={`Edit ${theme.name}`}
                  tip="Edit"
                  icon={
                    <SlidersHorizontal className="size-[length:var(--ui-icon-management-action)]" />
                  }
                  onClick={() => onEdit(theme.id)}
                />
                <Action
                  label={`Duplicate ${theme.name}`}
                  tip="Duplicate"
                  icon={<Copy className="size-[length:var(--ui-icon-management-action)]" />}
                  onClick={() => onDuplicate(theme.id)}
                />
                <InlineConfirm
                  onConfirm={() => {
                    confirmingDeleteRef.current = false;
                    onDelete(theme.id);
                  }}
                  confirmLabel={`Confirm delete ${theme.name}`}
                  cancelLabel={`Cancel delete ${theme.name}`}
                  onArmedChange={(armed) => {
                    confirmingDeleteRef.current = armed;
                  }}
                  trigger={(arm) => (
                    <Action
                      label={`Delete ${theme.name}`}
                      tip="Delete"
                      icon={<Trash2 className="size-[length:var(--ui-icon-management-action)]" />}
                      onClick={() => {
                        confirmingDeleteRef.current = true;
                        arm();
                      }}
                    />
                  )}
                />
              </>
            }
          />
        ))}
        {/* The dashed empty slot is the empty state; no "none yet" copy on top of it. */}
        <div className="px-1 pt-1">
          <AddButton label="Add Theme" onClick={onCreate} />
        </div>
      </PopoverContent>
    </Popover>
  );
}
