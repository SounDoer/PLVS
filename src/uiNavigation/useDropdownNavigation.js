import { useState } from "react";
import { useUiNavigationTarget, useUiSurface } from "./UiNavigationContext.jsx";

/**
 * Names one single-choice dropdown so the pointer can travel to it and `ui show dropdown` can open
 * it through the same open state a click sets. Spread `rootProps` on `Select` and `triggerProps` on
 * `SelectTrigger`. A caller that already owns the open state passes it in.
 *
 * @param {string | null | undefined} control A target id such as `setting:appearance.interfaceSize`.
 * @param {{ open?: boolean, onOpenChange?: (open: boolean) => void }} [owned]
 */
export function useDropdownNavigation(control, owned = {}) {
  const [localOpen, setLocalOpen] = useState(false);
  const open = owned.open ?? localOpen;
  const onOpenChange = owned.onOpenChange ?? setLocalOpen;
  const named = typeof control === "string" && control.length > 0;
  useUiNavigationTarget(
    "dropdown",
    named ? control : "",
    named ? { show: () => onOpenChange(true) } : {}
  );
  useUiSurface({
    active: named && open,
    kind: "dropdown",
    origin: "navigable",
    blocking: false,
    dismissible: true,
    supportedActions: ["close"],
    target: { control },
    onClose: () => onOpenChange(false),
  });
  return {
    rootProps: { open, onOpenChange },
    triggerProps: named ? { "data-ui-target": control } : {},
  };
}
