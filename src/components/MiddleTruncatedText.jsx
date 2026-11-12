import { useState } from "react";
import { cn } from "../lib/utils.js";
import { useHoverTip } from "./HoverTip.jsx";

// File names usually differ at the end (cue numbers, versions, extension), so the
// ellipsis goes in the middle and this many stem characters stay visible with the extension.
const TAIL_STEM_CHARS = 7;
const MIN_HEAD_CHARS = 8;

function splitTail(text) {
  const dot = text.lastIndexOf(".");
  const extension = dot > 0 && text.length - dot <= 6 ? text.slice(dot) : "";
  const stem = Array.from(extension ? text.slice(0, dot) : text);
  if (stem.length < TAIL_STEM_CHARS + MIN_HEAD_CHARS) return null;
  return [
    stem.slice(0, -TAIL_STEM_CHARS).join(""),
    stem.slice(-TAIL_STEM_CHARS).join("") + extension,
  ];
}

/**
 * One line of text that truncates in the middle and keeps its end visible. The full text
 * appears in a tooltip only while part of it is hidden.
 *
 * @param {{ text: string, className?: string }} props
 */
export function MiddleTruncatedText({ text, className }) {
  const [hoveredText, setHoveredText] = useState(undefined);
  const { anchorRef, showTip, hideTip, tipNode } = useHoverTip({
    tip: hoveredText === text ? text : undefined,
    align: "start",
    tipClassName: "max-w-[calc(100vw_-_16px)] whitespace-pre-wrap [overflow-wrap:anywhere]",
  });
  const parts = splitTail(text);
  const checkTruncation = (event) => {
    const target = event.currentTarget;
    const segments = parts ? Array.from(target.children) : [target];
    if (segments.some((segment) => segment.scrollWidth > segment.clientWidth)) {
      setHoveredText(text);
      showTip();
    }
  };
  return (
    <span
      ref={anchorRef}
      className={cn(parts ? "flex min-w-0 overflow-hidden whitespace-pre" : "truncate", className)}
      onPointerEnter={checkTruncation}
      onPointerLeave={hideTip}
    >
      {parts ? (
        <>
          <span className="min-w-0 overflow-hidden text-ellipsis">{parts[0]}</span>
          <span className="flex max-w-[calc(100%_-_1em)] shrink-0 justify-end overflow-hidden">
            {parts[1]}
          </span>
        </>
      ) : (
        text
      )}
      {tipNode}
    </span>
  );
}
