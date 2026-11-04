import { LoudnessProfilePopoverContent } from "../../components/LoudnessProfilePopover.jsx";
import { DockEditorShell } from "./DockEditorShell.jsx";

/// Shared profile management: the controller here forwards every choice to the main window,
/// which owns the Loudness Profile state and its persistence.
export function DockLoudnessProfileRow({ profile }) {
  return (
    <DockEditorShell title="Loudness Profile">
      <LoudnessProfilePopoverContent
        profile={profile}
        showTitle={false}
        onExport={profile.exportProfile}
      />
    </DockEditorShell>
  );
}
