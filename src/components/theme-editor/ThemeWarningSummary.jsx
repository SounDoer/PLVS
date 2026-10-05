import { CircleCheck, ClipboardCheck } from "lucide-react";
import { LinkButton } from "@/components/ui/link-button";

export function ThemeVisualReview({ warnings, onJump }) {
  return (
    <section aria-labelledby="theme-visual-review-title" className="flex flex-col gap-3">
      <div>
        <div className="flex items-center gap-1.5">
          <ClipboardCheck className="size-[length:var(--ui-icon-management-action)]" />
          <h2 id="theme-visual-review-title" className="font-semibold">
            Visual Review
          </h2>
        </div>
        <p className="mt-1 text-[length:var(--ui-fs-metric-meta)] text-muted-foreground">
          Recommended targets stay visible for review but never block saving or publication.
        </p>
      </div>
      {warnings.length ? (
        <div className="flex flex-col gap-2">
          {warnings.map((warning) => (
            <article key={warning.id} className="rounded-md border border-border bg-card p-3">
              <div className="text-[length:var(--ui-fs-metric-meta)] font-medium">
                {warning.title}
              </div>
              <p className="mt-0.5 text-[length:var(--ui-fs-axis)] leading-snug text-muted-foreground">
                {warning.message} Affects {warning.consumers.join(", ")}.
              </p>
              {warning.standard ? (
                <p className="mt-0.5 text-[length:var(--ui-fs-axis)] text-muted-foreground">
                  Reference: {warning.standard}
                </p>
              ) : null}
              <p className="mt-0.5 text-[length:var(--ui-fs-axis)] text-muted-foreground">
                Roles: {warning.roleIds.join(" · ")}
              </p>
              <LinkButton
                onClick={() => onJump(warning.target)}
                className="mt-1 text-[length:var(--ui-fs-axis)] font-medium text-primary hover:text-primary hover:underline"
              >
                Review {warning.target.id}
              </LinkButton>
            </article>
          ))}
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-md border border-border bg-card p-3 text-[length:var(--ui-fs-metric-meta)]">
          <CircleCheck className="size-[length:var(--ui-icon-management-action)] text-[color:var(--ui-feedback-success)]" />
          All checked relationships meet their recommended targets.
        </div>
      )}
    </section>
  );
}
