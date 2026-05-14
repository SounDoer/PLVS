import { useState, useRef, useEffect } from 'react';
import { Check, ChevronDown, LayoutGrid } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useWorkspaceStore } from './WorkspaceContext.jsx';
import { MODULE_REGISTRY } from './registry.jsx';
import { BUILTIN_PRESETS } from './constants.js';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Visibility Popover — toggle module visibility from the header
// ---------------------------------------------------------------------------

export function VisibilityPopover() {
  const { state, toggleModuleVisible, setFocus } = useWorkspaceStore();
  const { visibleModules } = state;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Module visibility"
          className="flex h-7 w-7 items-center justify-center rounded border border-border/60 bg-card/40 text-muted-foreground transition-colors hover:bg-card/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
        >
          <LayoutGrid size={14} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-44 p-1">
        <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Modules
        </p>
        {Object.values(MODULE_REGISTRY).map(({ id, title, Icon }) => {
          const isVisible = visibleModules.includes(id);
          return (
            <button
              key={id}
              type="button"
              className={cn(
                'flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs transition-colors hover:bg-muted/50',
                isVisible ? 'text-foreground' : 'text-muted-foreground'
              )}
              onClick={() => {
                toggleModuleVisible(id);
                if (!isVisible) setFocus(id);
              }}
            >
              <span className={cn('flex shrink-0', isVisible ? 'text-foreground' : 'text-muted-foreground/40')}>
                <Icon />
              </span>
              <span className="flex-1 text-left">{title}</span>
              <span
                className={cn(
                  'h-1.5 w-1.5 shrink-0 rounded-full',
                  isVisible ? 'bg-primary' : 'bg-muted-foreground/25'
                )}
              />
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Preset Dropdown — apply builtin/custom presets, save current as preset
// ---------------------------------------------------------------------------

function SavePresetForm({ onSave, onCancel }) {
  const [name, setName] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const commit = () => {
    if (name.trim()) {
      onSave(name.trim());
    }
  };

  return (
    <div className="flex items-center gap-1">
      <input
        ref={inputRef}
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') onCancel();
        }}
        placeholder="Preset name…"
        className="h-7 w-24 rounded border border-primary bg-background px-2 text-xs outline-none"
      />
      <button
        type="button"
        className="flex h-7 items-center rounded bg-primary px-2 text-xs font-medium text-primary-foreground hover:brightness-95 disabled:opacity-50"
        disabled={!name.trim()}
        onClick={commit}
      >
        Save
      </button>
      <button
        type="button"
        aria-label="Cancel"
        className="rounded p-1 text-xs text-muted-foreground hover:text-foreground"
        onClick={onCancel}
      >
        ✕
      </button>
    </div>
  );
}

export function PresetDropdown() {
  const { state, applyPreset, saveCurrentAsPreset } = useWorkspaceStore();
  const { activePresetId, customPresets } = state;
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const allPresets = [...BUILTIN_PRESETS, ...customPresets];
  const displayName = allPresets.find((p) => p.id === activePresetId)?.name ?? 'Custom';

  if (saving) {
    return (
      <SavePresetForm
        onSave={(name) => {
          saveCurrentAsPreset(name);
          setSaving(false);
        }}
        onCancel={() => setSaving(false)}
      />
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-7 min-w-[7rem] items-center justify-between gap-1 rounded border border-border/60 bg-card/40 px-2 text-xs text-muted-foreground transition-colors hover:bg-card/60 hover:text-foreground"
        >
          <span className="truncate">{displayName}</span>
          <ChevronDown size={12} className="shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-44 p-1">
        <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Presets
        </p>
        {BUILTIN_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs transition-colors hover:bg-muted/50"
            onClick={() => { applyPreset(p.id); setOpen(false); }}
          >
            {p.id === activePresetId
              ? <Check size={10} className="shrink-0 text-primary" />
              : <span className="w-[10px] shrink-0" />}
            {p.name}
          </button>
        ))}
        {customPresets.length > 0 && (
          <>
            <div className="my-1 h-px bg-border/50" />
            {customPresets.map((p) => (
              <button
                key={p.id}
                type="button"
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs transition-colors hover:bg-muted/50"
                onClick={() => { applyPreset(p.id); setOpen(false); }}
              >
                {p.id === activePresetId
                  ? <Check size={10} className="shrink-0 text-primary" />
                  : <span className="w-[10px] shrink-0" />}
                {p.name}
              </button>
            ))}
          </>
        )}
        <div className="my-1 h-px bg-border/50" />
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
          onClick={() => { setOpen(false); setSaving(true); }}
        >
          <span className="w-[10px] shrink-0" />
          Save as preset…
        </button>
      </PopoverContent>
    </Popover>
  );
}
