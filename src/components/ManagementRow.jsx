import { cn } from "@/lib/utils";

export const MANAGEMENT_ROW_CLASS =
  "group flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs transition-colors hover:bg-muted/50 focus-within:bg-muted/50";

export const MANAGEMENT_ROW_ACTIONS_CLASS =
  "flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100";

export function ManagementIconAction({ label, icon, onClick, className, disabled = false, title }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={title}
      disabled={disabled}
      className={cn(
        "rounded p-0.5 text-muted-foreground opacity-70 transition-colors hover:text-foreground hover:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-30",
        className
      )}
      onClick={onClick}
    >
      {icon}
    </button>
  );
}
