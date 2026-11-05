import { FLOATING_EDITOR_CLASS } from "@/components/ui/surfaceStyles.js";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check, Eye, Pencil, Redo2, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ColorControl } from "./ColorControl.jsx";
import { ConfirmDialog } from "@/components/ConfirmDialog.jsx";
import { ResetAction } from "@/components/ResetAction.jsx";
import { useFloatingPanelDrag } from "../hooks/useFloatingPanelDrag.js";
import { PalettesPage } from "./theme-editor/PalettesPage.jsx";
import { AdvancedPage } from "./theme-editor/AdvancedPage.jsx";
import { ThemePreview } from "./theme-editor/ThemePreview.jsx";
import { BUILTIN_THEMES_V2 } from "../theme/builtinThemesV2.js";
import { HoverTip } from "@/components/HoverTip";
import { IconAction } from "@/components/ui/icon-action";
import { TabButton } from "@/components/ui/tab-button";

// Muted icon buttons in the editor header (rename pencil, and the confirm/cancel while renaming),
// matching LoudnessProfileEditor. `onPointerDown` on each stops the drag handle grabbing the click.

const CORE_COLORS = [
  {
    key: "workspace",
    label: "Workspace",
    description: "The app canvas behind panels and meters.",
  },
  {
    key: "surface",
    label: "Surface",
    description: "Panels, cards, popovers, and controls.",
  },
  {
    key: "text",
    label: "Text",
    description: "Primary labels and values. Secondary text is derived.",
  },
  {
    key: "interfaceAccent",
    label: "Interface Accent",
    description: "Selected controls, focus, and active UI states.",
  },
  {
    key: "primaryData",
    label: "Primary Data",
    description: "The main measurement trace or visual emphasis.",
  },
  {
    key: "secondaryData",
    label: "Secondary Data",
    description: "Comparison traces and supporting measurements.",
  },
];

/**
 * @param {{
 *   draft: object,
 *   onName: (s: string) => void,
 *   onColorScheme: (scheme: "dark"|"light") => void,
 *   onCore: (key: string, css: string) => void,
 *   onResetCore: () => void,
 *   onPaletteColor: (palette: string, key: string, css: string) => void,
 *   previewOpen?: boolean,
 *   onPreviewOpenChange?: (...args: any[]) => any,
 *   onIntensityStop: (index: number, css: string) => void,
 *   onIntensityStops: (stops: object[]) => void,
 *   onApplyPreset: (palette: string, presetId: string) => void,
 *   onOverride: (roleId: string, override: object|null) => void,
 *   onResetOverrides: (roleIds: string[]) => void,
 *   onUndo: () => void,
 *   onRedo: () => void,
 *   canUndo?: boolean,
 *   canRedo?: boolean,
 *   canSave?: boolean,
 *   onSave: () => void,
 *   onCancel: () => void,
 *   onDelete?: () => void,
 *   dirty?: boolean,
 *   stale?: boolean,
 *   pos: {x:number,y:number},
 *   onMove: (p: {x:number,y:number}) => void,
 * }} props
 */
/**
 * @param {{
 *   draft: import("../theme/themeSchema.js").ThemeDocument,
 *   onName: (...args: any[]) => any,
 *   onColorScheme?: (...args: any[]) => any,
 *   onCore: (...args: any[]) => any,
 *   onResetCore?: (...args: any[]) => any,
 *   onPaletteColor: (...args: any[]) => any,
 *   previewOpen?: boolean,
 *   onPreviewOpenChange?: (...args: any[]) => any,
 *   onIntensityStop: (...args: any[]) => any,
 *   onIntensityStops: (...args: any[]) => any,
 *   onApplyPreset: (...args: any[]) => any,
 *   onOverride: (...args: any[]) => any,
 *   onResetOverrides?: (...args: any[]) => any,
 *   onUndo: (...args: any[]) => any,
 *   onRedo: (...args: any[]) => any,
 *   canUndo?: boolean,
 *   canRedo?: boolean,
 *   canSave?: boolean,
 *   onSave: (...args: any[]) => any,
 *   onCancel: (...args: any[]) => any,
 *   onDismiss?: (...args: any[]) => any,
 *   discardOpen?: boolean,
 *   onDiscardOpenChange?: (...args: any[]) => any,
 *   onConfirmDiscard?: (...args: any[]) => any,
 *   editorDraftDecision?: {editorKind: string, editorSurfaceId: string}|null,
 *   page?: "core"|"palettes"|"advanced",
 *   onPageChange?: (...args: any[]) => any,
 *   onDelete?: (...args: any[]) => any,
 *   dirty: boolean,
 *   stale?: boolean,
 *   pos: any,
 *   onMove: (...args: any[]) => any,
 * }} props
 */
export function ThemeEditor({
  draft,
  onName,
  onColorScheme = () => {},
  onCore,
  onResetCore = () => {},
  onPaletteColor,
  previewOpen: controlledPreviewOpen,
  onPreviewOpenChange,
  onIntensityStop,
  onIntensityStops,
  onApplyPreset,
  onOverride,
  onResetOverrides = () => {},
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
  canSave = true,
  onSave,
  onCancel,
  onDismiss,
  discardOpen: controlledDiscardOpen,
  onDiscardOpenChange,
  onConfirmDiscard,
  editorDraftDecision = null,
  page: controlledPage,
  onPageChange,
  onDelete,
  dirty,
  stale = false,
  pos,
  onMove,
}) {
  const [localDiscardOpen, setLocalDiscardOpen] = useState(false);
  const [localPage, setLocalPage] = useState("core");
  const discardDialogOpen = controlledDiscardOpen ?? localDiscardOpen;
  const page = controlledPage ?? localPage;
  const setDiscardDialogOpen = onDiscardOpenChange ?? setLocalDiscardOpen;
  const setPage = useCallback(
    (next) => {
      if (controlledPage === undefined) setLocalPage(next);
      onPageChange?.(next);
    },
    [controlledPage, onPageChange]
  );
  const [localPreviewOpen, setLocalPreviewOpen] = useState(false);
  const previewOpen = controlledPreviewOpen ?? localPreviewOpen;
  const setPreviewOpen = onPreviewOpenChange ?? setLocalPreviewOpen;
  const [focusTarget, setFocusTarget] = useState(null);
  const builtinCore = BUILTIN_THEMES_V2[`plvs-${draft.colorScheme}`].core;
  const coreIsDefault = Object.keys(builtinCore).every(
    (key) => draft.core[key] === builtinCore[key]
  );
  const clearFocusTarget = useCallback(() => setFocusTarget(null), []);

  useEffect(() => {
    if (!focusTarget || focusTarget.page === "advanced" || focusTarget.page !== page) return;
    requestAnimationFrame(() => {
      const target = document.querySelector(`[data-theme-target="${focusTarget.id}"]`);
      target?.scrollIntoView?.({ block: "center" });
      setFocusTarget(null);
    });
  }, [focusTarget, page]);

  // The name edits like the Loudness Profile editor: static until the pencil opens an input, which
  // commits on blur / Enter / the confirm button and reverts on Escape / the cancel button.
  // `skipNameCommit` lets Escape blur without committing.
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(draft.name ?? "");
  const skipNameCommit = useRef(false);
  const nameInputRef = useRef(null);

  useEffect(() => {
    if (!renaming) setNameDraft(draft.name ?? "");
  }, [draft.name, renaming]);

  useEffect(() => {
    if (renaming) {
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
    }
  }, [renaming]);

  function startRename() {
    setNameDraft(draft.name ?? "");
    setRenaming(true);
  }

  function commitName() {
    if (skipNameCommit.current) {
      skipNameCommit.current = false;
      setRenaming(false);
      return;
    }
    onName(nameDraft);
    setRenaming(false);
  }

  /// The cancel button's explicit path, twin of Escape: close the field, keep the stored name.
  function cancelName() {
    setNameDraft(draft.name ?? "");
    setRenaming(false);
  }

  function handleCancel() {
    if (onDismiss) {
      onDismiss();
      return;
    }
    if (!dirty) {
      onCancel();
      return;
    }
    setDiscardDialogOpen(true);
  }

  const ref = useRef(null);
  const dragHandlers = useFloatingPanelDrag(ref, onMove);
  const previewScroll = useRef(null);
  useLayoutEffect(() => {
    const body = ref.current?.querySelector("[data-settings-editor-body]");
    if (!body) return undefined;
    if (previewOpen) {
      previewScroll.current ??= {
        page,
        top: body.scrollTop,
        width: body.clientWidth,
        height: body.clientHeight,
      };
      return undefined;
    }
    const saved = previewScroll.current;
    if (!saved || saved.page !== page) {
      previewScroll.current = null;
      return undefined;
    }
    // The hidden editor still lays out when Dock Preview expands its native host. At the end
    // of a long page this clamps scrollTop. Restore again when the host shrinks back, rather
    // than treating the first (still expanded) close render as the final editor geometry.
    let observer;
    const restore = () => {
      body.scrollTop = saved.top;
      if (body.clientWidth === saved.width && body.clientHeight === saved.height) {
        previewScroll.current = null;
        observer?.disconnect();
      }
    };
    if (typeof ResizeObserver === "function") {
      observer = new ResizeObserver(restore);
      observer.observe(body);
    }
    restore();
    return () => observer?.disconnect();
  }, [previewOpen, page]);

  return (
    <>
      <div
        ref={ref}
        role="dialog"
        data-settings-editor
        aria-label="Theme editor"
        className={FLOATING_EDITOR_CLASS}
        inert={previewOpen}
        style={{ left: pos.x, top: pos.y, visibility: previewOpen ? "hidden" : undefined }}
      >
        <div
          {...dragHandlers}
          className="flex cursor-move items-center gap-1 border-b border-border px-3 py-2"
        >
          {renaming ? (
            <>
              <input
                ref={nameInputRef}
                aria-label="Theme name"
                value={nameDraft}
                onChange={(event) => setNameDraft(event.target.value)}
                // The header is a drag handle; stop the pointer so selecting text never drags the
                // window.
                onPointerDown={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                  if (event.key === "Escape") {
                    skipNameCommit.current = true;
                    event.currentTarget.blur();
                  }
                }}
                onBlur={commitName}
                className="plvs-input h-[var(--ui-control-h)] min-w-0 flex-1 rounded-md border border-input bg-transparent px-2 text-[length:var(--ui-fs-panel-title)] font-semibold"
              />
              {/* `preventDefault` on mousedown keeps the input focused so the click commits/cancels
                  explicitly rather than racing the input's blur. */}
              <IconAction
                aria-label="Save theme name"
                onPointerDown={(event) => event.stopPropagation()}
                onMouseDown={(event) => event.preventDefault()}
                onClick={commitName}
                className="shrink-0"
              >
                <Check className="size-[length:var(--ui-icon-management-action)]" />
              </IconAction>
              <IconAction
                aria-label="Cancel rename"
                onPointerDown={(event) => event.stopPropagation()}
                onMouseDown={(event) => event.preventDefault()}
                onClick={cancelName}
                className="shrink-0"
              >
                <X className="size-[length:var(--ui-icon-management-action)]" />
              </IconAction>
            </>
          ) : (
            <>
              <span className="min-w-0 flex-1 truncate text-[length:var(--ui-fs-panel-title)] font-semibold">
                {draft.name?.trim() ? (
                  draft.name
                ) : (
                  <span className="text-muted-foreground">Untitled</span>
                )}
              </span>
              <div
                role="group"
                aria-label="Theme appearance"
                className="flex rounded-md border border-border bg-muted p-1"
                onPointerDown={(event) => event.stopPropagation()}
              >
                {["dark", "light"].map((scheme) => (
                  <button
                    key={scheme}
                    type="button"
                    aria-pressed={draft.colorScheme === scheme}
                    onClick={() => onColorScheme(scheme)}
                    className={`rounded-xs px-2 py-0 text-[length:var(--ui-fs-axis)] capitalize ${draft.colorScheme === scheme ? "bg-ui-hover text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    {scheme}
                  </button>
                ))}
              </div>
              <HoverTip tip="Undo" className="shrink-0">
                <IconAction
                  aria-label="Undo theme change"
                  disabled={!canUndo}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={onUndo}
                  className="shrink-0 disabled:opacity-50"
                >
                  <Undo2 className="size-[length:var(--ui-icon-management-action)]" />
                </IconAction>
              </HoverTip>
              <HoverTip tip="Redo" className="shrink-0">
                <IconAction
                  aria-label="Redo theme change"
                  disabled={!canRedo}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={onRedo}
                  className="shrink-0 disabled:opacity-50"
                >
                  <Redo2 className="size-[length:var(--ui-icon-management-action)]" />
                </IconAction>
              </HoverTip>
              <HoverTip tip="Rename" className="shrink-0">
                <IconAction
                  aria-label="Rename theme"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={startRename}
                  className="shrink-0"
                >
                  <Pencil className="size-[length:var(--ui-icon-management-action)]" />
                </IconAction>
              </HoverTip>
            </>
          )}
        </div>

        {stale ? (
          <p className="border-l-2 border-[color:var(--ui-feedback-warning)] bg-secondary px-3 py-2 text-[length:var(--ui-fs-control)] text-foreground">
            This Theme changed in another PLVS workbench. Saving will ask whether to reload it or
            keep this draft as a copy.
          </p>
        ) : null}

        <div
          role="tablist"
          aria-label="Theme editor pages"
          className="flex border-b border-border px-2"
        >
          {[
            ["core", "Core"],
            ["palettes", "Palettes"],
            ["advanced", "Advanced"],
          ].map(([id, label]) => (
            <TabButton key={id} selected={page === id} onClick={() => setPage(id)}>
              {label}
            </TabButton>
          ))}
        </div>

        <div
          data-settings-editor-body
          className="flex min-h-0 flex-col gap-3 overflow-y-auto px-3 py-2"
        >
          {page === "core" ? (
            <section aria-labelledby="theme-core-title" className="flex flex-col gap-3">
              <div>
                <div className="flex items-center justify-between gap-2">
                  <Label id="theme-core-title">Core Colors</Label>
                  <ResetAction
                    data-core-reset-action
                    label={`Reset Core Colors to ${draft.colorScheme === "dark" ? "Dark" : "Light"} defaults`}
                    tip={`Reset to ${draft.colorScheme === "dark" ? "Dark" : "Light"} Defaults`}
                    defaultTip={`Using ${draft.colorScheme === "dark" ? "Dark" : "Light"} Defaults`}
                    isDefault={coreIsDefault}
                    onReset={onResetCore}
                    confirmLabel="Confirm reset Core Colors"
                    cancelLabel="Cancel reset Core Colors"
                  />
                </div>
                <p className="mt-0 text-[length:var(--ui-fs-metric-meta)] text-muted-foreground">
                  Related colors are generated automatically.
                </p>
              </div>
              {CORE_COLORS.map(({ key, label, description }) => (
                <div key={key} data-theme-target={`core.${key}`}>
                  <ColorControl
                    label={label}
                    description={description}
                    value={draft.core[key]}
                    onChange={(color) => onCore(key, color)}
                    allowAlpha={false}
                  />
                </div>
              ))}
            </section>
          ) : page === "palettes" ? (
            <PalettesPage
              draft={draft}
              onColor={onPaletteColor}
              onStop={onIntensityStop}
              onStops={onIntensityStops}
              onApplyPreset={onApplyPreset}
            />
          ) : (
            <AdvancedPage
              draft={draft}
              onOverride={onOverride}
              onResetOverrides={onResetOverrides}
              focusRoleId={focusTarget?.page === "advanced" ? focusTarget.id : null}
              onFocusHandled={clearFocusTarget}
            />
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2">
          {onDelete ? (
            <Button variant="ghost" onClick={onDelete} className="text-destructive">
              Delete
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setPreviewOpen(true)}>
              <Eye /> Open Theme Preview
            </Button>
            <Button variant="ghost" onClick={handleCancel}>
              Cancel
            </Button>
            <Button onClick={onSave} disabled={!canSave}>
              Save
            </Button>
          </div>
        </div>
      </div>
      <ConfirmDialog
        open={discardDialogOpen}
        onOpenChange={setDiscardDialogOpen}
        title="Discard theme changes?"
        description="Unsaved edits will be discarded and the previous theme will be restored."
        cancelLabel="Keep Editing"
        confirmLabel="Discard Changes"
        onConfirm={onConfirmDiscard ?? onCancel}
        editorDraftDecision={editorDraftDecision}
      />
      {previewOpen ? (
        <ThemePreview
          draft={draft}
          onClose={() => setPreviewOpen(false)}
          onJump={(target) => {
            // An explicit finding jump owns the destination, even when it stays on this page.
            previewScroll.current = null;
            setPreviewOpen(false);
            setPage(target.page);
            setFocusTarget(target);
          }}
        />
      ) : null}
    </>
  );
}
