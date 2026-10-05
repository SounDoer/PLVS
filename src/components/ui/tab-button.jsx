import * as React from "react";

import { cn } from "@/lib/utils";

/** One tab in an underlined tab strip. The strip itself carries `role="tablist"`. */
const TabButton = React.forwardRef(function TabButton(
  { selected = false, className, ...props },
  ref
) {
  return (
    <button
      ref={ref}
      type="button"
      role="tab"
      aria-selected={selected}
      className={cn(
        "border-b-2 px-3 py-1.5 text-[length:var(--ui-fs-metric-meta)]",
        selected
          ? "border-primary text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground",
        className
      )}
      {...props}
    />
  );
});

export { TabButton };
