import { useLayoutEffect, useRef, useState } from "react";
import { Pencil } from "lucide-react";
import { useFloatingPanelDrag } from "../hooks/useFloatingPanelDrag.js";
import { sourceMixName } from "../lib/sourceMixes.js";
import { useUiSurface } from "../uiNavigation/UiNavigationContext.jsx";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { IconAction } from "./ui/icon-action";
import { FLOATING_EDITOR_CLASS } from "./ui/surfaceStyles.js";

export function SourceMixEditor({ owner, applications }) {
  const { draft, saving, rename, cancel, save, toggle } = owner;
  const ref = useRef(null);
  const [position, setPosition] = useState(null);
  const [renaming, setRenaming] = useState(false);
  const originalName = useRef("");
  const drag = useFloatingPanelDrag(ref, setPosition);
  useLayoutEffect(() => ref.current?.focus(), []);
  const available = new Map(applications.map((application) => [application.id, application]));
  const checked = new Set(draft.members.map(({ id }) => id));
  const choices = [
    ...new Map(
      [
        ...(draft.original?.members ?? []),
        ...applications,
        ...draft.members.filter(({ id }) => !available.has(id)),
      ].map((member) => [member.id, member])
    ).values(),
  ];
  useUiSurface({
    kind: "sourceMixEditor",
    origin: "navigable",
    blocking: true,
    busy: saving,
    dismissible: true,
    supportedActions: ["cancel"],
    target: { intent: draft.id ? "edit" : "create", mixId: draft.id },
    onCancel: cancel,
    choices: [
      ...choices.map((member) => ({
        id: `toggle:${member.id}`,
        label: member.label,
        selected: checked.has(member.id),
        run: () => toggle(member),
      })),
      {
        id: "save",
        label: "Save",
        disabled: draft.members.length < 2,
        run: () => save({ throwOnError: true }),
      },
      { id: "cancel", label: "Cancel", run: cancel },
    ],
  });
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="mix editor"
      tabIndex={-1}
      data-settings-editor
      className={`${FLOATING_EDITOR_CLASS} ${position ? "" : "top-16 left-1/2 -translate-x-1/2"}`}
      style={position ? { left: position.x, top: position.y } : undefined}
    >
      <div
        {...drag}
        className="flex cursor-move items-center gap-1 border-b border-border px-3 py-2"
      >
        {renaming ? (
          <input
            autoFocus
            aria-label="mix name"
            value={draft.name}
            placeholder={sourceMixName(draft)}
            disabled={saving}
            onPointerDown={(event) => event.stopPropagation()}
            onChange={(event) => rename(event.target.value)}
            onBlur={() => setRenaming(false)}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") {
                rename(originalName.current);
                event.currentTarget.blur();
              }
            }}
            className="plvs-input h-[var(--ui-control-h)] min-w-0 flex-1 rounded-md border border-input bg-transparent px-2 text-[length:var(--ui-fs-panel-title)] font-semibold"
          />
        ) : (
          <>
            <span className="min-w-0 flex-1 truncate text-[length:var(--ui-fs-panel-title)] font-semibold">
              {sourceMixName(draft)}
            </span>
            <IconAction
              aria-label="rename mix"
              disabled={saving}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => {
                originalName.current = draft.name;
                setRenaming(true);
              }}
            >
              <Pencil className="size-[length:var(--ui-icon-management-action)]" />
            </IconAction>
          </>
        )}
      </div>
      <fieldset
        disabled={saving}
        className="min-h-0 overflow-y-auto px-3 py-2 text-[length:var(--ui-fs-control)]"
      >
        <legend className="pt-2 font-medium text-muted-foreground">Applications</legend>
        {choices.length === 0 ? (
          <p className="text-muted-foreground">No Applications Available</p>
        ) : null}
        {choices.map((member) => (
          <label
            key={member.id}
            className="flex min-h-[var(--ui-control-h)] cursor-pointer items-center gap-2 rounded-md px-1 hover:bg-ui-hover"
          >
            <Checkbox checked={checked.has(member.id)} onChange={() => toggle(member)} />
            <span className="min-w-0 flex-1 truncate">
              {available.get(member.id)?.label ?? member.label}
            </span>
            {available.has(member.id) ? null : (
              <span className="text-muted-foreground">Unavailable</span>
            )}
          </label>
        ))}
      </fieldset>
      <div className="flex items-center gap-2 border-t border-border px-3 py-2">
        <span
          className="min-w-0 flex-1 text-[length:var(--ui-fs-caption)] text-muted-foreground"
          aria-live="polite"
        >
          {draft.members.length} {draft.members.length === 1 ? "Source" : "Sources"} Selected
        </span>
        <Button variant="ghost" disabled={saving} onClick={cancel}>
          Cancel
        </Button>
        <Button disabled={saving || draft.members.length < 2} onClick={() => void save()}>
          Save
        </Button>
      </div>
    </div>
  );
}
