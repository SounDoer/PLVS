import { useCallback, useEffect, useRef, useState } from "react";

export function useCtrlHoverState() {
  const hoverRef = useRef(false);
  const [isCtrlHover, setIsCtrlHover] = useState(false);

  const notePointerMove = useCallback((e) => {
    hoverRef.current = true;
    setIsCtrlHover(e.ctrlKey);
  }, []);

  const notePointerLeave = useCallback(() => {
    hoverRef.current = false;
    setIsCtrlHover(false);
  }, []);

  useEffect(() => {
    const updateCtrlHover = (e) => {
      if (!hoverRef.current) return;
      setIsCtrlHover(e.ctrlKey);
    };
    const clearCtrlHover = () => setIsCtrlHover(false);
    window.addEventListener("keydown", updateCtrlHover);
    window.addEventListener("keyup", updateCtrlHover);
    window.addEventListener("blur", clearCtrlHover);
    return () => {
      window.removeEventListener("keydown", updateCtrlHover);
      window.removeEventListener("keyup", updateCtrlHover);
      window.removeEventListener("blur", clearCtrlHover);
    };
  }, []);

  return { isCtrlHover, notePointerMove, notePointerLeave };
}
