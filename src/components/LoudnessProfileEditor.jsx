import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Pencil, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { clampPanelPos } from "@/lib/dragClamp.js";
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
const TRIGGER_CLASS =
  "h-6 w-auto rounded-md border-transparent bg-transparent px-2 py-0 text-[length:var(--ui-fs-control)] shadow-none hover:border-border hover:bg-secondary/85 focus:ring-0 focus:ring-offset-0 focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-0";
const CONTENT_CLASS =
  "min-w-[var(--radix-select-trigger-width)] border-border/50 [&_[data-slot=select-item]]:py-1 [&_[data-slot=select-item]]:text-[length:var(--ui-fs-control)]";

// Sized in `ch`, not rem: the field's font-size is `--ui-fs-control`, which grows with the
// Interface Size preference, so a fixed rem width clips its own value at the larger settings and
// only there. 7ch clears the widest thing `fmtMetric` can produce (`-100.0`). The spinner goes
// because stepping a delivery threshold by 1 is never what anyone wants, and it overlaps the text.
const NUM_INPUT_CLASS =
  "h-6 w-[7ch] rounded-md border border-transparent bg-transparent px-1 py-0 text-center font-[family-name:var(--ui-font-mono)] text-[length:var(--ui-fs-control)] tabular-nums transition-colors [appearance:textfield] hover:border-border hover:bg-secondary/85 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none";

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

/// One rule: `metric  op  value  severity`. Reads as the breach sentence it is -- "True Peak above
/// −1 → Fail" -- so which side breaches is never in doubt.
function RuleRow({ index, rule, onPatch, onRemove }) {
  const meta = STATS_META[rule.metricId];
  const position = index + 1;

  return (
    <div className="flex items-center gap-1.5 py-0.5 text-[length:var(--ui-fs-control)]">
      <Select value={rule.metricId} onValueChange={(value) => onPatch({ metricId: value })}>
        <SelectTrigger
          aria-label={`Rule ${position} metric`}
          className={`${TRIGGER_CLASS} min-w-0 flex-1`}
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

      <Select value={rule.op} onValueChange={(value) => onPatch({ op: value })}>
        <SelectTrigger aria-label={`Rule ${position} operator`} className={TRIGGER_CLASS}>
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

      {/* `ch`, not rem, for the same reason as the field beside it. `dBTP` is the widest unit. */}
      <span className="w-[4.5ch] shrink-0 text-right text-muted-foreground/60">{meta?.unit}</span>

      <Select
        value={rule.severity ?? "warn"}
        onValueChange={(value) => onPatch({ severity: value })}
      >
        <SelectTrigger aria-label={`Rule ${position} severity`} className={TRIGGER_CLASS}>
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
        className="rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
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
        className="fixed z-50 flex max-h-[80vh] w-[26rem] flex-col gap-2 overflow-hidden rounded-[var(--ui-radius-modal)] border border-border bg-card text-card-foreground shadow-lg"
        style={{ left: pos.x, top: pos.y }}
      >
        <div
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          className="flex cursor-move items-center gap-1.5 border-b border-border px-3 py-2"
        >
          {renaming ? (
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
              className="min-w-0 flex-1 bg-transparent text-[length:var(--ui-fs-panel-title)] font-semibold focus-visible:outline-none"
            />
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
                className="shrink-0 rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <Pencil className="size-[length:var(--ui-icon-management-action)]" />
              </button>
            </>
          )}
        </div>

        <div className="flex flex-col gap-2 overflow-y-auto px-3 py-1">
          <div className="flex items-center gap-2 text-[length:var(--ui-fs-control)]">
            <span className="shrink-0 text-muted-foreground">Reference</span>
            <RuleNumber
              ariaLabel="Loudness Profile reference"
              metricId="integrated"
              value={ruleDocument.referenceLufs ?? null}
              onCommit={(next) => onEdit((d) => withReferenceLufs(d, next))}
            />
            <span className="text-muted-foreground/60">LUFS</span>
          </div>

          <div className="border-t border-border/40 pt-1">
            {rules.length > 0 ? (
              rules.map((rule, index) => (
                <RuleRow
                  key={index}
                  index={index}
                  rule={rule}
                  onPatch={(patch) => patchRule(index, patch)}
                  onRemove={() => removeRule(index)}
                />
              ))
            ) : (
              <p className="px-1 py-1 text-[length:var(--ui-fs-caption)] text-muted-foreground">
                No rules — this profile does not judge any metrics.
              </p>
            )}
          </div>

          <div className="border-t border-border/40 pt-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label="Add rule"
              onClick={addRule}
              className="h-7 gap-1 px-2 text-[length:var(--ui-fs-control)]"
            >
              <Plus className="size-[length:var(--ui-icon-management-action)]" />
              Add rule
            </Button>
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
            className="fixed left-1/2 top-1/2 z-[61] w-80 -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-card p-6 text-card-foreground shadow-xl focus:outline-none"
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
