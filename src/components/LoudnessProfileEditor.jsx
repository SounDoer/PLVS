import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { clampPanelPos } from "@/lib/dragClamp.js";
import {
  METRIC_RULE_ROLE,
  createEmptyRule,
  withReferenceLufs,
} from "@/lib/loudnessProfileCatalog.js";
import { STATS_CANONICAL_ORDER, STATS_META } from "@/lib/statsCatalog.js";

const NUM_INPUT_CLASS =
  "h-6 w-14 rounded-md border border-transparent bg-transparent px-1 py-0 text-center font-[family-name:var(--ui-font-mono)] text-[length:var(--ui-fs-control)] tabular-nums transition-colors hover:border-border hover:bg-secondary/85 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

/**
 * One numeric field, committed on blur or Enter.
 *
 * Never per keystroke: clearing the box to retype lands an empty string, and typing `-14` passes
 * through `-1` on the way. Both would write a rule the user never asked for. Blank is a real
 * value here -- it means "not judged" -- so an empty commit clears the field rather than snapping
 * back.
 */
function RuleNumber({ ariaLabel, value, onCommit }) {
  const [text, setText] = useState(value == null ? "" : String(value));

  useEffect(() => {
    setText(value == null ? "" : String(value));
  }, [value]);

  const commit = () => {
    const trimmed = text.trim();
    if (trimmed === "") {
      onCommit(null);
      return;
    }
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) onCommit(parsed);
    else setText(value == null ? "" : String(value));
  };

  return (
    <input
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

/// One rule. The shape comes from the metric, never from the user: nobody thinks "I want a limit
/// rule on True Peak", they think "TP must not exceed -1".
function RuleRow({ metricId, rule, onPatch, onRemove }) {
  const meta = STATS_META[metricId];
  const label = meta?.label ?? metricId;

  return (
    <div className="flex items-center gap-1.5 py-0.5 text-[length:var(--ui-fs-control)]">
      <span className="min-w-0 flex-1 truncate text-muted-foreground">{label}</span>

      {rule.role === "target" ? (
        <>
          <RuleNumber
            ariaLabel={`${label} target`}
            value={rule.target ?? null}
            onCommit={(next) => onPatch({ target: next ?? undefined })}
          />
          <span className="text-muted-foreground">−</span>
          <RuleNumber
            ariaLabel={`${label} tolerance minus`}
            value={rule.tolerance?.minus ?? null}
            onCommit={(next) =>
              onPatch({ tolerance: { ...rule.tolerance, minus: next ?? undefined } })
            }
          />
          <span className="text-muted-foreground">+</span>
          <RuleNumber
            ariaLabel={`${label} tolerance plus`}
            value={rule.tolerance?.plus ?? null}
            onCommit={(next) =>
              onPatch({ tolerance: { ...rule.tolerance, plus: next ?? undefined } })
            }
          />
        </>
      ) : (
        <>
          <span className="text-muted-foreground">≥</span>
          <RuleNumber
            ariaLabel={`${label} minimum`}
            value={rule.min ?? null}
            onCommit={(next) => onPatch({ min: next ?? undefined })}
          />
          <span className="text-muted-foreground">≤</span>
          <RuleNumber
            ariaLabel={`${label} maximum`}
            value={rule.max ?? null}
            onCommit={(next) => onPatch({ max: next ?? undefined })}
          />
        </>
      )}

      <span className="w-8 shrink-0 text-right text-muted-foreground/60">{meta?.unit}</span>

      <select
        aria-label={`${label} severity`}
        value={rule.severity ?? "fail"}
        onChange={(event) => onPatch({ severity: event.target.value })}
        className="h-6 rounded-md border border-input bg-transparent px-1 text-[length:var(--ui-fs-control)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <option value="fail">Fail</option>
        <option value="warn">Warn</option>
      </select>

      <button
        type="button"
        aria-label={`Remove ${label}`}
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
  const [addOpen, setAddOpen] = useState(false);
  const ref = useRef(null);
  const dragRef = useRef(null);

  const ruleDocument = draft.document;
  const ruleIds = ruleDocument.preferredMetricIds ?? [];
  const addable = STATS_CANONICAL_ORDER.filter(
    (id) => METRIC_RULE_ROLE[id] && !ruleIds.includes(id)
  );

  function patchRule(metricId, patch) {
    onEdit((d) => ({
      ...d,
      metrics: { ...d.metrics, [metricId]: { ...d.metrics[metricId], ...patch } },
    }));
  }

  function addMetric(metricId) {
    setAddOpen(false);
    onEdit((d) => ({
      ...d,
      metrics: { ...d.metrics, [metricId]: createEmptyRule(metricId) },
      preferredMetricIds: [...(d.preferredMetricIds ?? []), metricId],
    }));
  }

  function removeMetric(metricId) {
    onEdit((d) => {
      const metrics = { ...d.metrics };
      delete metrics[metricId];
      return {
        ...d,
        metrics,
        preferredMetricIds: (d.preferredMetricIds ?? []).filter((id) => id !== metricId),
      };
    });
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
          className="flex cursor-move items-center border-b border-border px-3 py-2"
        >
          <input
            aria-label="Loudness Profile name"
            value={ruleDocument.name ?? ""}
            onChange={(event) => {
              const { value } = event.target;
              onEdit((d) => ({ ...d, name: value }));
            }}
            className="w-full bg-transparent text-[length:var(--ui-fs-panel-title)] font-semibold focus-visible:outline-none"
          />
        </div>

        <div className="flex flex-col gap-2 overflow-y-auto px-3 py-1">
          <div className="flex items-center gap-2 text-[length:var(--ui-fs-control)]">
            <span className="shrink-0 text-muted-foreground">Reference</span>
            <RuleNumber
              ariaLabel="Loudness Profile reference"
              value={ruleDocument.referenceLufs ?? null}
              onCommit={(next) => onEdit((d) => withReferenceLufs(d, next))}
            />
            <span className="text-muted-foreground/60">LUFS</span>
          </div>

          <div className="border-t border-border/40 pt-1">
            {ruleIds.map((metricId) =>
              ruleDocument.metrics?.[metricId] ? (
                <RuleRow
                  key={metricId}
                  metricId={metricId}
                  rule={ruleDocument.metrics[metricId]}
                  onPatch={(patch) => patchRule(metricId, patch)}
                  onRemove={() => removeMetric(metricId)}
                />
              ) : null
            )}
          </div>

          <div className="border-t border-border/40 pt-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label="Add metric"
              onClick={() => setAddOpen((open) => !open)}
              className="h-7 gap-1 px-2 text-[length:var(--ui-fs-control)]"
            >
              <Plus className="size-[length:var(--ui-icon-management-action)]" />
              Add metric
            </Button>
            {addOpen ? (
              <div className="mt-1 flex flex-col rounded border border-border/60 p-1">
                {addable.map((id) => (
                  <button
                    key={id}
                    type="button"
                    aria-label={`Add ${STATS_META[id]?.label ?? id}`}
                    onClick={() => addMetric(id)}
                    className="rounded px-1.5 py-1 text-left text-[length:var(--ui-fs-control)] hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    {STATS_META[id]?.label ?? id}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <p className="text-[length:var(--ui-fs-caption)] leading-snug text-muted-foreground">
            Delivery reference, not a certification. Dialogue metrics use on-device detection.
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-3 py-2">
          <Button variant="ghost" onClick={handleCancel}>
            Cancel
          </Button>
          <Button onClick={onSave} disabled={!(ruleDocument.name ?? "").trim()}>
            Save
          </Button>
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
