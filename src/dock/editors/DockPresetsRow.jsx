import { PresetsPopoverContent } from "../../components/PresetsPopover.jsx";
import { DockEditorShell } from "./DockEditorShell.jsx";

export function DockPresetsRow({ presets, onDone }) {
  return (
    <DockEditorShell title="Presets" onDone={onDone}>
      <PresetsPopoverContent presets={presets} />
    </DockEditorShell>
  );
}
