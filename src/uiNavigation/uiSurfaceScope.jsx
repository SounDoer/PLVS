import { createContext, useContext } from "react";

const UiSurfaceScopeContext = createContext(true);

/**
 * Marks the content of a popover, dialog or sheet as open or closing. A closing container keeps
 * its content mounted while it animates out, so a dropdown left open inside it would otherwise
 * stay registered as a UI surface after its parent has closed. Scopes nest: content is open only
 * while every enclosing container is.
 *
 * @param {{ active?: boolean, children?: import("react").ReactNode }} props
 */
export function UiSurfaceScope({ active = true, children }) {
  const parentActive = useContext(UiSurfaceScopeContext);
  return (
    <UiSurfaceScopeContext.Provider value={parentActive && active !== false}>
      {children}
    </UiSurfaceScopeContext.Provider>
  );
}

/** Whether every container enclosing the caller is open. */
export function useUiSurfaceScopeActive() {
  return useContext(UiSurfaceScopeContext);
}
