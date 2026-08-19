import { Check, Copy, Pencil, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { IconButton } from "./IconButton.jsx";
import { InlineConfirm } from "./InlineConfirm.jsx";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover.jsx";
import { BUILTIN_THEMES_V2 } from "../theme/builtinThemesV2.js";

function ThemeSwatch({ theme }) {
  const colors = [
    theme.core.workspace,
    theme.core.surface,
    theme.core.interfaceAccent,
    theme.core.primaryData,
    theme.core.secondaryData,
  ];
  return (
    <span
      aria-hidden="true"
      className="flex h-3 w-12 shrink-0 overflow-hidden rounded-sm border border-border"
    >
      {colors.map((color, index) => (
        <span key={`${color}-${index}`} className="flex-1" style={{ backgroundColor: color }} />
      ))}
    </span>
  );
}

function Action({ label, icon, onClick }) {
  return (
    <IconButton
      aria-label={label}
      tip={label}
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
    <div className="flex min-h-8 items-center gap-1 rounded px-1 hover:bg-secondary/85">
      <button
        type="button"
        onClick={() => onSelect(theme.id)}
        className="flex min-w-0 flex-1 items-center gap-2 text-left text-[length:var(--ui-fs-display)]"
      >
        <span className="flex size-4 items-center justify-center">
          {selected ? <Check className="size-3.5" /> : null}
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
          className="flex min-h-6 items-center gap-2 rounded-md border border-transparent bg-transparent px-2 py-0.5 text-[length:var(--ui-fs-display)] hover:border-border hover:bg-secondary/85 disabled:opacity-40"
        >
          {selected ? <ThemeSwatch theme={selected} /> : null}
          <span>{selected?.name ?? "Theme"}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-1">
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
                icon={<Copy className="size-[length:var(--ui-icon-management-action)]" />}
                onClick={() => onCustomize(theme.id)}
              />
            }
          />
        ))}
        <div className="mt-1 border-t border-border px-2 pb-1 pt-2 text-[length:var(--ui-fs-metric-meta)] font-semibold text-muted-foreground">
          Custom
        </div>
        {customThemes.length ? (
          customThemes.map((theme) => (
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
                    icon={<Pencil className="size-[length:var(--ui-icon-management-action)]" />}
                    onClick={() => onEdit(theme.id)}
                  />
                  <Action
                    label={`Duplicate ${theme.name}`}
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
          ))
        ) : (
          <div className="px-2 py-2 text-[length:var(--ui-fs-metric-meta)] text-muted-foreground">
            No custom themes yet.
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
