import { ChevronRight } from "lucide-react";
import { cn } from "../lib/utils.js";
import { SelectionDot } from "./ui/row.jsx";

const SOURCE_LEADING_CLASS = "grid w-[1em] shrink-0 place-items-center";

/** @param {{ primary: string, secondary?: string, selected: boolean }} props */
export function SourceOptionContent({ primary, secondary, selected }) {
  return (
    <>
      <span aria-hidden="true" className={SOURCE_LEADING_CLASS}>
        <SelectionDot selected={selected} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-foreground">{primary}</span>
        {secondary ? (
          <span className="mt-0 block truncate text-muted-foreground">{secondary}</span>
        ) : null}
      </span>
    </>
  );
}

/** @param {{ label: string, count: number, open: boolean, selectedSummary?: string | null }} props */
export function SourceGroupHeading({ label, count, open, selectedSummary }) {
  return (
    <>
      <span aria-hidden="true" className={SOURCE_LEADING_CLASS}>
        <ChevronRight
          className={cn(
            "size-[1em] text-muted-foreground transition-transform",
            open && "rotate-90"
          )}
        />
      </span>
      <span className="shrink-0 font-medium text-muted-foreground">{label}</span>
      {!open && selectedSummary ? (
        <>
          <SelectionDot selected />
          <span className="min-w-0 truncate text-foreground">
            {selectedSummary}
            <span className="sr-only">, selected</span>
          </span>
        </>
      ) : null}
      <span className="ml-auto shrink-0 text-[length:var(--ui-fs-caption)] tabular-nums text-muted-foreground">
        {count}
      </span>
    </>
  );
}
