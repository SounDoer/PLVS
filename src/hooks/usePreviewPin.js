import { useEffect, useRef, useState } from "react";

/** Shared hover preview and click/keyboard pin behavior. */
export function usePreviewPin() {
  const [mode, setMode] = useState("closed");
  const modeRef = useRef("closed");
  const closeTimer = useRef(null);
  const returnFocusRef = useRef(false);
  const cancelClose = () => clearTimeout(closeTimer.current);
  const changeMode = (nextMode) => {
    cancelClose();
    returnFocusRef.current = modeRef.current === "pinned";
    modeRef.current = nextMode;
    setMode(nextMode);
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => {
      if (modeRef.current !== "pinned") {
        modeRef.current = "closed";
        setMode("closed");
      }
    }, 180);
  };
  useEffect(() => () => clearTimeout(closeTimer.current), []);
  const onEscape = (event) => {
    if (event.key !== "Escape" || modeRef.current === "closed") return;
    event.preventDefault();
    event.stopPropagation();
    changeMode("closed");
  };
  return { mode, modeRef, returnFocusRef, cancelClose, changeMode, scheduleClose, onEscape };
}
