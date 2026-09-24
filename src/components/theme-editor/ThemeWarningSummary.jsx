import { TriangleAlert } from "lucide-react";

export function ThemeWarningSummary({ warnings, onJump }) {
  if (!warnings.length) return null;

  return (
    <details className="rounded-md border border-[color:color-mix(in_srgb,var(--ui-interface-warning)_45%,var(--border))] bg-[color:color-mix(in_srgb,var(--ui-interface-warning)_8%,transparent)]">
      <summary className="flex cursor-pointer select-none items-center gap-1.5 px-2 py-1.5 text-[length:var(--ui-fs-metric-meta)] font-semibold text-[color:var(--ui-feedback-warning)]">
        <TriangleAlert className="size-[length:var(--ui-icon-management-action)]" />
        {warnings.length} Visual Warning{warnings.length === 1 ? "" : "s"}
      </summary>
      <div className="flex flex-col gap-2 border-t border-border px-2 py-2">
        {warnings.map((warning) => (
          <div key={warning.id} className="rounded-xs bg-background/35 p-2">
            <div className="text-[length:var(--ui-fs-metric-meta)] font-medium">
              {warning.title}
            </div>
            <p className="mt-0.5 text-[length:var(--ui-fs-axis)] leading-snug text-muted-foreground">
              {warning.message} Affects {warning.consumers.join(", ")}.
            </p>
            <p className="mt-0.5 text-[length:var(--ui-fs-axis)] text-muted-foreground">
              Roles: {warning.roleIds.join(" · ")}
            </p>
            <button
              type="button"
              onClick={() => onJump(warning.target)}
              className="mt-1 text-[length:var(--ui-fs-axis)] font-medium text-primary hover:underline"
            >
              Review {warning.target.id}
            </button>
          </div>
        ))}
      </div>
    </details>
  );
}
