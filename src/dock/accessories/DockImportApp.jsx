import { useEffect, useLayoutEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  AlsoIncluded,
  COMPLETION_ACTION_LABEL,
  PlanRow,
  isSingleExistingReview,
  isExistingReview,
} from "../../components/ItemPickerDialog.jsx";
import { PACK_KINDS } from "../../transfer/packShape.js";
import { useAccessoryClient } from "./useAccessoryClient.js";

export function DockImportApp() {
  const { payload, action } = useAccessoryClient("dock-import");
  const key = payload?.key;
  const rootRef = useRef(null);
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!key || !root) return;
    let previous = 0;
    const measure = () => {
      const height = Math.ceil(root.getBoundingClientRect().height);
      if (height > 0 && height !== previous) {
        previous = height;
        void action("import-resize", { key, height });
      }
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(root);
    return () => observer?.disconnect();
  }, [action, key, payload]);
  useEffect(() => {
    if (key) void action("import-ready", { key });
  }, [action, key]);
  useEffect(() => {
    const escape = (event) => {
      if (event.key === "Escape" && !payload?.busy) void action("import-dismiss", { key });
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [action, key, payload?.busy]);
  if (!key) return null;
  const { mode, review, status, busy } = payload;
  const descriptor = review ? PACK_KINDS[review.type] : null;
  const send = (type) => void action(type, { key });
  const allExisting = mode === "review" && isExistingReview(review);
  const existingReview = allExisting && isSingleExistingReview(review);
  const single = mode === "complete" && review?.itemPlan?.length === 1;
  return (
    <div className="max-h-screen overflow-y-auto">
      <main
        ref={rootRef}
        className="rounded-xl border border-border bg-card p-3 text-[length:var(--ui-fs-control)] text-foreground"
        data-dock-import
      >
        <h1 className="font-semibold">
          {mode === "review"
            ? `Paste ${descriptor.itemLabel}`
            : mode === "complete"
              ? "Import Complete"
              : "Paste"}
        </h1>
        {mode === "status" ? (
          <p role="status">{status}</p>
        ) : (
          <>
            <p className="text-muted-foreground">
              {mode === "review"
                ? existingReview
                  ? "This item is already in your library."
                  : "Review what will be added to your library."
                : single
                  ? `${review.itemPlan[0].name} is now in your library.`
                  : "The items are now in your library."}
            </p>
            <ul className="my-3">
              {review.itemPlan.map((entry) => (
                <PlanRow key={entry.sourceId} entry={entry} completed={mode === "complete"} />
              ))}
            </ul>
            {review.profilePlan?.length > 0 ? (
              <AlsoIncluded>
                {review.profilePlan.map((entry) => (
                  <PlanRow key={entry.sourceId} entry={entry} />
                ))}
              </AlsoIncluded>
            ) : null}
            {review.warnings?.length > 0 ? (
              <section aria-label="Import Warnings">
                <h2>Adaptations</h2>
                <ul>
                  {review.warnings.map((warning, index) => (
                    <li key={`${warning.code}-${index}`}>{warning.message}</li>
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        )}
        {mode !== "status" && status ? (
          <p role="status" className="mt-2 text-muted-foreground">
            {status}
          </p>
        ) : null}
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="ghost" disabled={busy} onClick={() => send("import-dismiss")}>
            {mode === "review" && !allExisting ? "Cancel" : "Done"}
          </Button>
          {allExisting && !existingReview ? null : existingReview ? (
            <Button disabled={busy} onClick={() => send("import-action")}>
              {COMPLETION_ACTION_LABEL[review.type]}
            </Button>
          ) : mode === "review" ? (
            <Button disabled={busy} onClick={() => send("import-confirm")}>
              {review.itemPlan.some((entry) => entry.disposition !== "skipped")
                ? `Add ${descriptor.itemLabel}`
                : "Import"}
            </Button>
          ) : single ? (
            <Button disabled={busy} onClick={() => send("import-action")}>
              {COMPLETION_ACTION_LABEL[review.type]}
            </Button>
          ) : null}
        </div>
      </main>
    </div>
  );
}
