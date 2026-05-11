import { useCallback, useRef } from "react";

export function useLayoutDrag({
  preferences,
  mainLeft,
  leftTopRatio,
  rightTopRatio,
  loudnessHistWidthRatio,
  setMainLeft,
  setLeftTopRatio,
  setRightTopRatio,
  setLoudnessHistWidthRatio,
}) {
  const layoutDragRef = useRef(null);

  const beginLayoutDrag = useCallback(
    (mode, ev) => {
      layoutDragRef.current = {
        mode,
        x: ev.clientX,
        y: ev.clientY,
        mainLeft,
        leftTopRatio,
        rightTopRatio,
        loudnessHistWidthRatio,
      };
      try {
        ev.currentTarget.setPointerCapture(ev.pointerId);
      } catch (_) {}
    },
    [mainLeft, leftTopRatio, rightTopRatio, loudnessHistWidthRatio]
  );

  const onLayoutDragMove = useCallback(
    (ev) => {
      const d = layoutDragRef.current;
      if (!d) return;
      if (d.mode === "main") {
        const { dragMinPx, dragMaxPx } = preferences.layout.mainColumn;
        setMainLeft(Math.max(dragMinPx, Math.min(dragMaxPx, d.mainLeft + (ev.clientX - d.x))));
      } else if (d.mode === "left") {
        const { dragMinRatio, dragMaxRatio, dragPixelsPerDelta } = preferences.layout.leftSplit;
        setLeftTopRatio(
          Math.max(
            dragMinRatio,
            Math.min(dragMaxRatio, d.leftTopRatio + (ev.clientY - d.y) / dragPixelsPerDelta)
          )
        );
      } else if (d.mode === "right") {
        const { dragMinRatio, dragMaxRatio, dragPixelsPerDelta } = preferences.layout.rightSplit;
        setRightTopRatio(
          Math.max(
            dragMinRatio,
            Math.min(dragMaxRatio, d.rightTopRatio + (ev.clientY - d.y) / dragPixelsPerDelta)
          )
        );
      } else if (d.mode === "hm") {
        const hm = preferences.layout.loudnessHistMetrics;
        const base =
          typeof d.loudnessHistWidthRatio === "number" ? d.loudnessHistWidthRatio : hm.initialRatio;
        setLoudnessHistWidthRatio(
          Math.max(
            hm.dragMinRatio,
            Math.min(hm.dragMaxRatio, base + (ev.clientX - d.x) / hm.dragPixelsPerDelta)
          )
        );
      }
    },
    [preferences, setMainLeft, setLeftTopRatio, setRightTopRatio, setLoudnessHistWidthRatio]
  );

  const onLayoutDragUp = useCallback((ev) => {
    layoutDragRef.current = null;
    try {
      ev.currentTarget.releasePointerCapture(ev.pointerId);
    } catch (_) {}
  }, []);

  return {
    beginLayoutDrag,
    onLayoutDragMove,
    onLayoutDragUp,
  };
}
