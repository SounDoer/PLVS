import { TruncatingLabel } from "./TruncatingLabel.jsx";
import { SelectionDot } from "./ui/row.jsx";
import { cn } from "../lib/utils.js";

/** @param {{ text: string, selected: boolean, showTruncationTip?: boolean, selectionLabel?: string, className?: string }} props */
export function NamedOptionContent({
  text,
  selected,
  showTruncationTip,
  selectionLabel,
  className,
}) {
  const labelClass = cn("min-w-0 flex-1", className);
  return (
    <>
      <SelectionDot selected={selected} label={selectionLabel} />
      {showTruncationTip ? (
        <TruncatingLabel text={text} className={labelClass} />
      ) : (
        <span className={cn("truncate", labelClass)}>{text}</span>
      )}
    </>
  );
}
