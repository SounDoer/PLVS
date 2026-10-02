import { forwardRef, useRef, useState } from "react";
import { useHoverTip } from "../HoverTip.jsx";

const ADJUST_KEYS = new Set([
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
  "PageUp",
  "PageDown",
]);

// A shared interaction layer; callers retain their live or release-only commit policy.
export const RangeInput = forwardRef(function RangeInput(
  {
    valueLabel,
    onPointerDown,
    onPointerUp,
    onPointerCancel,
    onLostPointerCapture,
    onKeyDown,
    onKeyUp,
    onBlur,
    onFocus,
    onMouseEnter,
    onMouseLeave,
    ...props
  },
  ref
) {
  const [adjusting, setAdjusting] = useState(false);
  const hovering = useRef(false);
  const { anchorRef, showTip, hideTip, tipNode } = useHoverTip({
    tip: valueLabel,
    side: "top",
    align: "end",
  });
  const end = (event, handler) => {
    setAdjusting(false);
    if (!hovering.current && !event.currentTarget.matches(":focus-visible")) hideTip();
    handler?.(event);
  };
  return (
    <>
      <input
        {...props}
        type="range"
        ref={(node) => {
          anchorRef.current = node;
          if (typeof ref === "function") ref(node);
          else if (ref) ref.current = node;
        }}
        data-adjusting={adjusting || undefined}
        onMouseEnter={(event) => {
          hovering.current = true;
          showTip();
          onMouseEnter?.(event);
        }}
        onMouseLeave={(event) => {
          hovering.current = false;
          if (!adjusting && !event.currentTarget.matches(":focus-visible")) hideTip();
          onMouseLeave?.(event);
        }}
        onFocus={(event) => {
          showTip();
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setAdjusting(false);
          hideTip();
          onBlur?.(event);
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          setAdjusting(true);
          showTip();
          onPointerDown?.(event);
        }}
        onPointerUp={(event) => end(event, onPointerUp)}
        onPointerCancel={(event) => end(event, onPointerCancel)}
        onLostPointerCapture={(event) => end(event, onLostPointerCapture)}
        onKeyDown={(event) => {
          if (ADJUST_KEYS.has(event.key)) {
            setAdjusting(true);
            showTip();
          }
          onKeyDown?.(event);
        }}
        onKeyUp={(event) => {
          if (ADJUST_KEYS.has(event.key)) end(event, onKeyUp);
          else onKeyUp?.(event);
        }}
      />
      {valueLabel != null && !props.disabled ? tipNode : null}
    </>
  );
});
