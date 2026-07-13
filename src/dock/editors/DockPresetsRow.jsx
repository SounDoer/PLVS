import { PresetsPopoverContent } from "../../components/PresetsPopover.jsx";
import { DockEditorShell } from "./DockEditorShell.jsx";

export function DockPresetsRow({ presets }) {
  return (
    <DockEditorShell title="Presets">
      <PresetsPopoverContent presets={presets} showTitle={false} />
    </DockEditorShell>
  );
}
