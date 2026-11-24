import { cn } from "@/lib/utils";
import { LABEL_TEXT_CLASS } from "./controlStyles.js";

/** @param {import("react").ComponentProps<"label">} props */
export function Label({ className, ...props }) {
  return (
    <label
      data-slot="label"
      className={cn(
        LABEL_TEXT_CLASS,
        "peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className
      )}
      {...props}
    />
  );
}
