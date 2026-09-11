import { parseSelection } from "./loudnessProfileCatalog.js";

/// The Loudness Profile a reading is judged against right now, or null when there is none.
///
/// `document` is what `LoudnessProfileContext` exposes: the open editor's draft when there is one,
/// otherwise the active saved profile. A draft is `preview` and carries the id of the profile being
/// edited (null for one never saved). Measurement inspection and file reports both describe the
/// profile through this, so they cannot disagree about which profile judged a number.
export function describeActiveLoudnessProfile({ active, document, draft } = {}) {
  if (!document) return null;
  const preview = draft != null;
  const selection = parseSelection(active);
  return {
    mode: preview ? "preview" : "saved",
    id: preview ? (draft.editingId ?? null) : selection.kind === "profile" ? selection.id : null,
    name: document.name ?? null,
    document,
  };
}
