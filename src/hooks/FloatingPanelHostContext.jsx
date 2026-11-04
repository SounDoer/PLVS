import { createContext, useContext } from "react";
const FloatingPanelHostContext = createContext(null);
const ModalBackdropElementContext = createContext(null);
export function FloatingPanelHostProvider({
  startDragging,
  getModalBackdropElement = null,
  children,
}) {
  return (
    <FloatingPanelHostContext.Provider value={startDragging}>
      <ModalBackdropElementContext.Provider value={getModalBackdropElement}>
        {children}
      </ModalBackdropElementContext.Provider>
    </FloatingPanelHostContext.Provider>
  );
}
export function useFloatingPanelHost() {
  return useContext(FloatingPanelHostContext);
}

/** A transparent native host darkens its content surface, never the desktop behind its gutter. */
export function useModalBackdropElement() {
  return useContext(ModalBackdropElementContext);
}
