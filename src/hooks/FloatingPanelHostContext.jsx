import { createContext, useContext } from "react";
const FloatingPanelHostContext = createContext(null);
export function FloatingPanelHostProvider({ startDragging, children }) {
  return (
    <FloatingPanelHostContext.Provider value={startDragging}>
      {children}
    </FloatingPanelHostContext.Provider>
  );
}
export function useFloatingPanelHost() {
  return useContext(FloatingPanelHostContext);
}
