import * as React from "react";
import { GripVertical } from "lucide-react";

import { cn } from "@/lib/utils";

/** The grip that starts a reorder or placement drag. `dragging` holds its hover colour. */
const DragHandle = React.forwardRef(function DragHandle(
  { dragging = false, className, ...props },
  ref
) {
  return (
    <button
      ref={ref}
      type="button"
      className={cn(
        "flex size-5 shrink-0 cursor-grab touch-none items-center justify-center rounded-xs text-muted-foreground hover:text-foreground active:cursor-grabbing",
        dragging && "text-foreground",
        className
      )}
      {...props}
    >
      <GripVertical className="size-3.5" />
    </button>
  );
});

export { DragHandle };
