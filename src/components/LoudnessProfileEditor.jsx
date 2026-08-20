import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Check, GripVertical, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AddButton } from "@/components/AddButton";
import { useTruncationTip } from "@/components/HoverTip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { clampPanelPos } from "@/lib/dragClamp.js";
import { cn } from "@/lib/utils";
import { usePointerReorder } from "@/hooks/usePointerReorder.js";
import {
  RULEABLE_METRIC_IDS,
  createEmptyRule,
  withReferenceLufs,
} from "@/lib/loudnessProfileCatalog.js";
import { STATS_META, roundToStatPrecision, statDecimals } from "@/lib/statsCatalog.js";

/// A new rule opens on Integrated: the metric every delivery reference judges. The user re-picks it
/// from the row's own metric select.
const DEFAULT_RULE_METRIC = "integrated";

// Matches the compact, borderless-until-hover selects the other panels use (see FocusViewPopover).
// No width here on purpose for the metric select: its trigger is `w-full`, so it fills the grid's
// flexible column. The operator and severity selects add an explicit width (below) instead, because
// they sit in a grid instance separate from Reference's own row (see GRID_TEMPLATE_CLASS) and a bare
// `auto` column would size independently in each, breaking the value/unit alignment between them.
// `gap-1` tightens the base `gap-2` between label and chevron (tailwind-merge keeps this one).
const TRIGGER_CLASS =
  "h-6 gap-1 rounded-md border-transparent bg-transparent px-2 py-0 text-[length:var(--ui-fs-control)] shadow-none hover:border-border hover:bg-muted/50";
const CONTENT_CLASS =
  "min-w-[var(--radix-select-trigger-width)] border-border/50 [&_[data-slot=select-item]]:py-1 [&_[data-slot=select-item]]:text-[length:var(--ui-fs-control)]";

/// Reference's row and the rule list are two separate grid instances -- the rule list needs its own
/// bounding box for the drag-reorder row-height math (see `usePointerReorder`), which Reference must
/// stay outside of since it can never be dragged. Splitting them means every column but the flexible
/// metric one needs an explicit, shared width instead of per-instance `auto` sizing, or the two grids
/// would compute different column widths and the value/unit columns would stop lining up between them.
// `relative`: the dragging-row overlay in RuleRow is an absolutely-positioned grid child that
// tracks its row via `grid-row`/`grid-column`, and that only resolves against the grid's own
// track boundaries when the grid itself is the containing block -- without `relative` here it
// falls back to the nearest positioned ancestor, sizing itself to whatever box that happens to be.
const GRID_TEMPLATE_CLASS =
  "relative grid grid-cols-[auto_minmax(0,1fr)_auto_auto_auto_auto_auto] items-center gap-x-1 gap-y-0.5 text-[length:var(--ui-fs-control)]";
const GRIP_COL_CLASS = "w-5";
const OP_COL_CLASS = "w-11";
const UNIT_COL_CLASS = "w-9";
const SEVERITY_COL_CLASS = "w-14";
const REMOVE_COL_CLASS = "w-5";

// Sized in `ch`, not rem: the field's font-size is `--ui-fs-control`, which grows with the
// Interface Size preference, so a fixed rem width clips its own value at the larger settings and
// only there. 7ch clears the widest thing `fmtMetric` can produce (`-100.0`). The spinner goes
// because stepping a delivery threshold by 1 is never what anyone wants, and it overlaps the text.
// The muted icon buttons in the editor header (rename pencil, and the confirm/cancel that replace it
// while renaming). `onPointerDown` on each stops the drag handle from grabbing the click.
const HEADER_ACTION_CLASS = "shrink-0 rounded-xs text-muted-foreground hover:text-foreground";

const NUM_INPUT_CLASS =
  "h-6 w-[7ch] rounded-md border border-transparent bg-transparent px-1 py-0 text-right font-[family-name:var(--ui-font-mono)] text-[length:var(--ui-fs-control)] tabular-nums transition-colors [appearance:textfield] hover:border-border hover:bg-muted/50 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none";

/**
 * One numeric field, committed on blur or Enter.
 *
 * Never per keystroke: clearing the box to retype lands an empty string, and typing `-14` passes
 * through `-1` on the way. Both would write a rule the user never asked for. Blank is a real
 * value here -- it means "not judged" -- so an empty commit clears the field rather than snapping
 * back.
 *
 * Commits are rounded to what the Stats panel shows for `metricId`, so a threshold is never finer
 * than the reading it judges, and the settled field is padded to that same number of decimals.
 * Half-typed input is left alone -- the padding only lands once the user is done, or the trailing
 * dot in `14.` would be filled in from under the cursor.
 */
function RuleNumber({ ariaLabel, metricId, value, onCommit }) {
  const settled = (v) => (v == null ? "" : v.toFixed(statDecimals(metricId)));
  const [text, setText] = useState(() => settled(value));
  const inputRef = useRef(null);

  // Only adopt an incoming value when the user is not mid-edit. Without this, a re-render from
  // anywhere else -- a rename, a preset apply, the live preview settling -- overwrites whatever
  // is half-typed in a focused field, and the keystrokes vanish with nothing to show for them.
  useEffect(() => {
    if (inputRef.current && globalThis.document?.activeElement === inputRef.current) return;
    setText(value == null ? "" : value.toFixed(statDecimals(metricId)));
  }, [value, metricId]);

  const commit = () => {
    const trimmed = text.trim();
    if (trimmed === "") {
      onCommit(null);
      return;
    }
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) {
      const rounded = roundToStatPrecision(metricId, parsed);
      // Rounding and padding both leave the box disagreeing with what was committed, and the
      // effect above will not correct it when the committed number is unchanged. Re-render the
      // field itself.
      setText(settled(rounded));
      onCommit(rounded);
    } else setText(settled(value));
  };

  return (
    <input
      ref={inputRef}
      type="number"
      aria-label={ariaLabel}
      value={text}
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
      className={NUM_INPUT_CLASS}
    />
  );
}

/// The metric select, with a themed tip that appears only when the label is too long for this
/// narrow column. Mouse-only, never focus: a focus tip would latch open when Radix returns focus to
/// the trigger after a pick. The tip shows the full name the clamp is hiding.
function MetricSelect({ position, rule, onPatch }) {
  const meta = STATS_META[rule.metricId];
  const { anchorRef, showIfClipped, hideTip, tipNode } = useTruncationTip({
    tip: meta?.label ?? rule.metricId,
  });

  return (
    <>
      <Select value={rule.metricId} onValueChange={(value) => onPatch({ metricId: value })}>
        <SelectTrigger
          ref={anchorRef}
          aria-label={`Rule ${position} metric`}
          // The clamped text is the SelectValue span inside the trigger, not the trigger itself.
          onMouseEnter={() => showIfClipped(anchorRef.current?.querySelector(":scope > span"))}
          onMouseLeave={hideTip}
          className={`${TRIGGER_CLASS} w-full min-w-0`}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent className={CONTENT_CLASS}>
          {RULEABLE_METRIC_IDS.map((id) => (
            <SelectItem key={id} value={id}>
              {STATS_META[id]?.label ?? id}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {tipNode}
    </>
  );
}

/// One rule: `metric  op  value  severity`. Reads as the breach sentence it is -- "True Peak above
/// −1 → Fail" -- so which side breaches is never in doubt. The row is `display:contents`: its seven
/// cells drop into the shared grid in RuleList so every column lines up across rows.
///
/// `position` is the row's on-screen order (1-based), not its index in the rules array -- the two
/// diverge the moment a drag reorders the list, and every aria-label reads as what the user sees.
function RuleRow({ position, rule, dragging, onDragStart, onPatch, onRemove }) {
  const meta = STATS_META[rule.metricId];

  return (
    <div className="contents">
      {/* The row itself has no box to ring -- `display:contents` drops the seven cells straight
          into the shared grid. `absolute` is load-bearing, not decoration: a normal grid item
          spanning every column would reserve that whole row for itself, and the seven real cells
          -- auto-placed, not explicitly positioned -- would get pushed into the row below rather
          than share it. Absolutely-positioned grid children keep their `grid-row`/`grid-column` as
          a positioning reference (a real part of the Grid spec) but are dropped from layout, so
          this overlay tracks the row without ever competing with it for space.
          The row-end line is explicit (`position + 1`), not `auto`: `auto` means "span one track"
          for a normal item, but for an abspos one it resolves to the far edge of the grid instead,
          which stretched this to the bottom of the whole list the one time it was left implicit. */}
      {dragging && (
        <div
          aria-hidden="true"
          style={{ gridRow: `${position} / ${position + 1}`, gridColumn: "1 / -1" }}
          className="pointer-events-none absolute inset-0 rounded-md ring-1 ring-primary/60"
        />
      )}

      <button
        type="button"
        aria-label={`Reorder rule ${position}`}
        onPointerDown={onDragStart}
        className={cn(
          GRIP_COL_CLASS,
          "-ml-1 flex size-5 shrink-0 cursor-grab touch-none items-center justify-center rounded-xs text-muted-foreground transition-colors hover:text-foreground active:cursor-grabbing",
          dragging && "text-foreground"
        )}
      >
        <GripVertical className="size-3.5" />
      </button>

      <MetricSelect position={position} rule={rule} onPatch={onPatch} />

      <Select value={rule.op} onValueChange={(value) => onPatch({ op: value })}>
        <SelectTrigger
          aria-label={`Rule ${position} operator`}
          className={cn(TRIGGER_CLASS, OP_COL_CLASS)}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent className={CONTENT_CLASS}>
          <SelectItem value=">">&gt;</SelectItem>
          <SelectItem value="<">&lt;</SelectItem>
        </SelectContent>
      </Select>

      <RuleNumber
        ariaLabel={`Rule ${position} value`}
        metricId={rule.metricId}
        value={rule.value ?? null}
        onCommit={(next) => onPatch({ value: next ?? undefined })}
      />

      <span className={cn(UNIT_COL_CLASS, "text-muted-foreground/60")}>{meta?.unit}</span>

      <Select
        value={rule.severity ?? "warn"}
        onValueChange={(value) => onPatch({ severity: value })}
      >
        <SelectTrigger
          aria-label={`Rule ${position} severity`}
          className={cn(TRIGGER_CLASS, SEVERITY_COL_CLASS)}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent className={CONTENT_CLASS}>
          <SelectItem value="fail">Fail</SelectItem>
          <SelectItem value="warn">Warn</SelectItem>
        </SelectContent>
      </Select>

      <button
        type="button"
        aria-label={`Remove rule ${position}`}
        onClick={onRemove}
        className={cn(
          REMOVE_COL_CLASS,
          "flex items-center justify-center rounded-xs text-muted-foreground hover:text-foreground"
        )}
      >
        <X className="size-[length:var(--ui-icon-management-action)]" />
      </button>
    </div>
  );
}

/**
 * Floating editor for one Loudness Profile draft.
 *
 * Presentational: it owns the drag position handling and the discard prompt, and nothing else.
 * Every change goes out through `onEdit`, which the provider applies to the preview draft, so the
 * meter repaints as the user types.
 *
 * Nothing here writes `document.id`. `normalizeRuleDocument` rejects an id-less document, which
 * would blank the preview mid-edit.
 */
export function LoudnessProfileEditor({ draft, onEdit, onSave, onCancel, pos, onMove }) {
  const [discardOpen, setDiscardOpen] = useState(false);
  const ref = useRef(null);
  const dragRef = useRef(null);
  const nameInputRef = useRef(null);

  const ruleDocument = draft.document;
  const rules = ruleDocument.rules ?? [];

  // The name edits presets-style: existing profiles stay static until the pencil opens an input,
  // while every new draft opens straight into its prefilled name. `skipNameCommit` lets Escape blur
  // without committing.
  const [renaming, setRenaming] = useState(() => draft.editingId === null);
  const [nameDraft, setNameDraft] = useState(draft.document.name ?? "Untitled");
  const incomingNameRef = useRef(draft.document.name ?? "Untitled");
  const skipNameCommit = useRef(false);
  incomingNameRef.current = draft.document.name ?? "Untitled";

  useEffect(() => {
    setNameDraft(incomingNameRef.current);
    setRenaming(draft.editingId === null);
  }, [draft.editingId]);

  useEffect(() => {
    if (renaming) {
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
    }
  }, [renaming]);

  function startRename() {
    setNameDraft(ruleDocument.name ?? "");
    setRenaming(true);
  }

  function commitName() {
    if (skipNameCommit.current) {
      skipNameCommit.current = false;
      setRenaming(false);
      return;
    }
    onEdit((d) => ({ ...d, name: nameDraft }));
    setRenaming(false);
  }

  /// The cancel button's explicit path, twin of Escape: close the field, keep the stored name.
  function cancelName() {
    setNameDraft(incomingNameRef.current);
    setRenaming(false);
  }

  /// Repointing a rule at another metric clears its threshold. A number typed for one metric is
  /// not a number for the next -- `-23.5` LUFS carried onto Dialogue Coverage is a nonsense
  /// percentage the row would nonetheless present as a setting the user chose. Blank is a real
  /// state here (the rule judges nothing), so the row is honest about needing a new value rather
  /// than quietly keeping the old one at the wrong precision.
  function patchRule(index, patch) {
    onEdit((d) => ({
      ...d,
      rules: (d.rules ?? []).map((rule, i) => {
        if (i !== index) return rule;
        const next = { ...rule, ...patch };
        if (patch.metricId !== undefined && patch.metricId !== rule.metricId)
          next.value = undefined;
        return next;
      }),
    }));
  }

  function addRule() {
    onEdit((d) => ({
      ...d,
      rules: [...(d.rules ?? []), createEmptyRule(DEFAULT_RULE_METRIC)],
    }));
  }

  function removeRule(index) {
    onEdit((d) => ({ ...d, rules: (d.rules ?? []).filter((_, i) => i !== index) }));
  }

  /// Reordering is cosmetic -- `loudnessProfileEvaluate` takes the worst fired rule regardless of
  /// array order -- so the ids `usePointerReorder` tracks are just the rules array's own positions
  /// ("0", "1", ...), not a stable identity carried across renders the way a real id would be.
  function reorderRules(nextIds) {
    onEdit((d) => {
      const current = d.rules ?? [];
      const next = nextIds.map((id) => current[Number(id)]).filter(Boolean);
      return next.length === current.length ? { ...d, rules: next } : d;
    });
  }

  const ruleIds = rules.map((_, i) => String(i));
  const {
    containerRef: ruleListRef,
    orderedIds,
    draggingId,
    startDrag,
  } = usePointerReorder(ruleIds, reorderRules);
  // `orderedIds` lags `ruleIds` by a tick when it changes for a reason other than a drag (the hook
  // debounces every resync, drag or not -- see its own comment) -- so an add/remove must render
  // straight from `ruleIds` or the new/removed row would flash in a render late. Mid-drag, though,
  // `orderedIds` is the only thing carrying the live reorder the pointer is producing.
  const displayRuleIds = draggingId ? orderedIds : ruleIds;

  function handleCancel() {
    if (draft.dirty) setDiscardOpen(true);
    else onCancel();
  }

  function onPointerDown(e) {
    const rect = ref.current.getBoundingClientRect();
    dragRef.current = {
      dx: e.clientX - rect.left,
      dy: e.clientY - rect.top,
      w: rect.width,
      h: rect.height,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e) {
    const d = dragRef.current;
    if (!d) return;
    onMove(
      clampPanelPos(
        { x: e.clientX - d.dx, y: e.clientY - d.dy },
        { w: d.w, h: d.h },
        { w: window.innerWidth, h: window.innerHeight }
      )
    );
  }
  function onPointerUp() {
    dragRef.current = null;
  }

  return (
    <>
      <div
        ref={ref}
        role="dialog"
        aria-label="Loudness Profile editor"
        className="fixed z-50 flex max-h-[80vh] w-[26rem] flex-col gap-2 overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-lg"
        style={{ left: pos.x, top: pos.y }}
      >
        <div
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          className="flex cursor-move items-center gap-1.5 border-b border-border px-3 py-2"
        >
          {renaming ? (
            <>
              <input
                ref={nameInputRef}
                aria-label="Loudness Profile name"
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
                className="h-7 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2 text-[length:var(--ui-fs-panel-title)] font-semibold shadow-sm"
              />
              {/* `preventDefault` on mousedown keeps the input focused so the click commits/cancels
                  explicitly rather than racing the input's blur. */}
              <button
                type="button"
                aria-label="Save profile name"
                onPointerDown={(event) => event.stopPropagation()}
                onMouseDown={(event) => event.preventDefault()}
                onClick={commitName}
                className={HEADER_ACTION_CLASS}
              >
                <Check className="size-[length:var(--ui-icon-management-action)]" />
              </button>
              <button
                type="button"
                aria-label="Cancel rename"
                onPointerDown={(event) => event.stopPropagation()}
                onMouseDown={(event) => event.preventDefault()}
                onClick={cancelName}
                className={HEADER_ACTION_CLASS}
              >
                <X className="size-[length:var(--ui-icon-management-action)]" />
              </button>
            </>
          ) : (
            <>
              <span className="min-w-0 flex-1 truncate text-[length:var(--ui-fs-panel-title)] font-semibold">
                {ruleDocument.name?.trim() ? (
                  ruleDocument.name
                ) : (
                  <span className="text-muted-foreground">Untitled</span>
                )}
              </span>
              <button
                type="button"
                aria-label="Rename profile"
                title="Rename"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={startRename}
                className={HEADER_ACTION_CLASS}
              >
                <Pencil className="size-[length:var(--ui-icon-management-action)]" />
              </button>
            </>
          )}
        </div>

        <div className="flex flex-col gap-2 overflow-y-auto px-3 py-1">
          {/* Reference is the profile's anchor, not a rule -- it can never be dragged, so it is its
              own grid instance rather than sharing a container with the reorderable rule list below
              (see GRID_TEMPLATE_CLASS for why every column but the flexible one still lines up). It
              reads as the plain first row: metric and value columns filled, the rest empty. */}
          <div className={GRID_TEMPLATE_CLASS}>
            <span className={cn(GRIP_COL_CLASS, "-ml-1")} />
            {/* `px-2` matches the metric trigger's text inset so Reference lines up with the metric
                names below; no color class means it inherits the same foreground they use. */}
            <span className="px-2">Reference</span>
            <span className={OP_COL_CLASS} />
            <RuleNumber
              ariaLabel="Loudness Profile reference"
              metricId="integrated"
              value={ruleDocument.referenceLufs ?? null}
              onCommit={(next) => onEdit((d) => withReferenceLufs(d, next))}
            />
            <span className={cn(UNIT_COL_CLASS, "text-muted-foreground/60")}>LUFS</span>
            <span className={SEVERITY_COL_CLASS} />
            <span className={REMOVE_COL_CLASS} />
          </div>

          {rules.length > 0 ? (
            <div
              ref={ruleListRef}
              data-testid="loudness-rule-order-list"
              className={GRID_TEMPLATE_CLASS}
            >
              {displayRuleIds.map((id, position) => {
                const rule = rules[Number(id)];
                if (!rule) return null;
                return (
                  <RuleRow
                    key={id}
                    position={position + 1}
                    rule={rule}
                    dragging={draggingId === id}
                    onDragStart={(event) => startDrag(id, event)}
                    onPatch={(patch) => patchRule(Number(id), patch)}
                    onRemove={() => removeRule(Number(id))}
                  />
                );
              })}
            </div>
          ) : (
            <p className="px-1 py-1 text-[length:var(--ui-fs-caption)] text-muted-foreground">
              No rules — this profile does not judge any metrics.
            </p>
          )}

          <div className="border-t border-border/40 pt-1">
            <AddButton label="Add Rule" onClick={addRule} />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-3 py-2">
          <Button variant="ghost" onClick={handleCancel}>
            Cancel
          </Button>
          <Button onClick={onSave}>Save</Button>
        </div>
      </div>

      <Dialog.Root open={discardOpen} onOpenChange={setDiscardOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/60" />
          <Dialog.Content
            role="alertdialog"
            className="fixed left-1/2 top-1/2 z-[61] w-80 -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card p-6 text-card-foreground shadow-xl"
          >
            <Dialog.Title className="mb-3 text-[length:var(--ui-fs-body)] font-semibold text-foreground">
              Discard profile changes?
            </Dialog.Title>
            <Dialog.Description className="mb-6 text-[length:var(--ui-fs-body)] text-muted-foreground">
              Unsaved rule edits will be discarded.
            </Dialog.Description>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setDiscardOpen(false)}>
                Keep Editing
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  setDiscardOpen(false);
                  onCancel();
                }}
              >
                Discard Changes
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
