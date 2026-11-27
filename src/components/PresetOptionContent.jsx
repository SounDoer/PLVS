import { TruncatingLabel } from "./TruncatingLabel.jsx";
import { SelectionDot } from "./ui/row.jsx";

const PRESET_NAME_CLASS = "min-w-0 flex-1 text-foreground";

/** @param {{ name: string, selected: boolean, modified?: boolean, showTruncationTip?: boolean, selectionLabel?: string }} props */
export function PresetOptionContent({
  name,
  selected,
  modified,
  showTruncationTip,
  selectionLabel,
}) {
  const text = modified ? `${name} *` : name;
  return (
    <>
      <SelectionDot selected={selected} label={selectionLabel} />
      {showTruncationTip ? (
        <TruncatingLabel text={text} className={PRESET_NAME_CLASS} />
      ) : (
        <span className={`truncate ${PRESET_NAME_CLASS}`}>{text}</span>
      )}
    </>
  );
}
