import { RotateCcw } from "lucide-react";
import { HoverTip } from "@/components/HoverTip.jsx";
import { InlineConfirm } from "@/components/InlineConfirm.jsx";
import { ManagementIconAction } from "@/components/ManagementRow.jsx";
import { cn } from "@/lib/utils";

/**
 * Standard two-step action for restoring a group of settings.
 *
 * The action keeps a constant footprint, remains visible while disabled, and
 * replaces itself with inline cancel/confirm controls when armed.
 */
export function ResetAction({
  label,
  onReset,
  isDefault = false,
  tip = label,
  defaultTip = "Using Defaults",
  confirmLabel = `Confirm ${label.toLowerCase()}`,
  cancelLabel = `Cancel ${label.toLowerCase()}`,
  side = "top",
  align = "end",
  className,
  onArmedChange,
  ...props
}) {
  return (
    <div data-reset-action className={cn("flex w-10 shrink-0 justify-end", className)} {...props}>
      <InlineConfirm
        className="w-10 justify-end"
        onConfirm={onReset}
        confirmLabel={confirmLabel}
        cancelLabel={cancelLabel}
        onArmedChange={onArmedChange}
        preserveTriggerSize
        trigger={(arm) => (
          <HoverTip tip={isDefault ? defaultTip : tip} side={side} align={align}>
            <ManagementIconAction
              icon={<RotateCcw className="size-[length:var(--ui-icon-management-action)]" />}
              label={label}
              disabled={isDefault}
              onClick={arm}
            />
          </HoverTip>
        )}
      />
    </div>
  );
}
