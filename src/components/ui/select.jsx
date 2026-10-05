import { POPOVER_SURFACE_CLASS } from "./surfaceStyles.js";
import * as React from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";

import { cn } from "@/lib/utils";
import { LAYER_FLOATING } from "./layers.js";

const Select = SelectPrimitive.Root;

const SelectGroup = SelectPrimitive.Group;

const SelectValue = SelectPrimitive.Value;

/**
 * The three shapes a select takes in PLVS. Trigger and menu share the name so a call site picks
 * one and passes it to both.
 *
 * - `inline`: 24px, Control size. A value inside a popover, dialog or editor row.
 * - `flush`: at least 24px, Display size, no right padding. A Settings row, where the chevron sits
 *   on the row's right edge and a long value may grow the row.
 * - `field`: 28px, Metric Annotation size. The Theme Editor's denser rows.
 */
const SELECT_TRIGGER_VARIANT_CLASS = {
  inline:
    "h-6 w-auto shrink-0 rounded-md border border-transparent bg-transparent px-2 py-0 text-[length:var(--ui-fs-control)] shadow-none hover:bg-ui-hover",
  flush:
    "h-auto min-h-6 w-auto shrink-0 rounded-md border border-transparent bg-transparent py-0.5 !pr-0 !pl-2 text-[length:var(--ui-fs-display)] shadow-none hover:bg-ui-hover",
  field:
    "h-7 w-auto shrink-0 gap-1 rounded-md border border-input bg-transparent px-2 py-0 text-[length:var(--ui-fs-metric-meta)] shadow-none hover:bg-ui-hover",
};

const SELECT_CONTENT_VARIANT_CLASS = {
  inline:
    "min-w-[var(--radix-select-trigger-width)] [&_[data-slot=select-item]]:py-1 [&_[data-slot=select-item]]:pr-6 [&_[data-slot=select-item]]:pl-2 [&_[data-slot=select-item]]:text-[length:var(--ui-fs-control)]",
  flush:
    "min-w-[var(--radix-select-trigger-width)] [&_[data-slot=select-item]]:py-1 [&_[data-slot=select-item]]:pr-6 [&_[data-slot=select-item]]:pl-2 [&_[data-slot=select-item]]:text-[length:var(--ui-fs-display)]",
  field:
    "min-w-[var(--radix-select-trigger-width)] [&_[data-slot=select-item]]:py-1 [&_[data-slot=select-item]]:pr-6 [&_[data-slot=select-item]]:pl-2 [&_[data-slot=select-item]]:text-[length:var(--ui-fs-metric-meta)]",
};

const SelectTrigger = React.forwardRef(({ variant, className, children, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    data-slot="select-trigger"
    data-control-field="true"
    className={cn(
      "border-input bg-background ring-offset-background data-[placeholder]:text-muted-foreground flex h-9 w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-[length:var(--ui-fs-body)] whitespace-nowrap outline-none disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1",
      SELECT_TRIGGER_VARIANT_CLASS[variant],
      className
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDown className="size-[1.15em] shrink-0 text-muted-foreground" />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
));
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName;

const SelectScrollUpButton = React.forwardRef(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollUpButton
    ref={ref}
    className={cn(
      "flex cursor-default items-center justify-center rounded-xs py-1 text-muted-foreground hover:bg-ui-hover hover:text-foreground",
      className
    )}
    {...props}
  >
    <ChevronUp className="size-[1.15em]" />
  </SelectPrimitive.ScrollUpButton>
));
SelectScrollUpButton.displayName = SelectPrimitive.ScrollUpButton.displayName;

const SelectScrollDownButton = React.forwardRef(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollDownButton
    ref={ref}
    className={cn(
      "flex cursor-default items-center justify-center rounded-xs py-1 text-muted-foreground hover:bg-ui-hover hover:text-foreground",
      className
    )}
    {...props}
  >
    <ChevronDown className="size-[1.15em]" />
  </SelectPrimitive.ScrollDownButton>
));
SelectScrollDownButton.displayName = SelectPrimitive.ScrollDownButton.displayName;

const SelectContent = React.forwardRef(
  ({ variant, className, children, position = "popper", ...props }, ref) => (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        ref={ref}
        data-slot="select-content"
        className={cn(
          POPOVER_SURFACE_CLASS,
          "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 relative max-h-96 min-w-[8rem] overflow-hidden",
          LAYER_FLOATING,
          position === "popper" &&
            "data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
          SELECT_CONTENT_VARIANT_CLASS[variant],
          className
        )}
        position={position}
        {...props}
      >
        <SelectScrollUpButton />
        <SelectPrimitive.Viewport
          className={cn(
            "p-1",
            position === "popper" &&
              "h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)] scroll-my-1"
          )}
        >
          {children}
        </SelectPrimitive.Viewport>
        <SelectScrollDownButton />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  )
);
SelectContent.displayName = SelectPrimitive.Content.displayName;

const SelectLabel = React.forwardRef(({ className, ...props }, ref) => (
  <SelectPrimitive.Label
    ref={ref}
    className={cn(
      "px-2 py-1.5 text-[length:var(--ui-fs-control)] font-semibold text-muted-foreground",
      className
    )}
    {...props}
  />
));
SelectLabel.displayName = SelectPrimitive.Label.displayName;

const SelectItem = React.forwardRef(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    data-slot="select-item"
    className={cn(
      "hover:bg-ui-hover data-[highlighted]:bg-ui-hover focus:bg-ui-hover relative flex w-full cursor-default select-none items-center rounded-xs py-1.5 pr-8 pl-2 text-[length:var(--ui-fs-body)] outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      className
    )}
    {...props}
  >
    <span className="absolute right-2 flex size-3.5 items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <Check className="size-[1.15em] text-primary" />
      </SelectPrimitive.ItemIndicator>
    </span>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
));
SelectItem.displayName = SelectPrimitive.Item.displayName;

const SelectSeparator = React.forwardRef(({ className, ...props }, ref) => (
  <SelectPrimitive.Separator
    ref={ref}
    className={cn("bg-muted pointer-events-none -mx-1 my-1 h-px", className)}
    {...props}
  />
));
SelectSeparator.displayName = SelectPrimitive.Separator.displayName;

export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
  SelectScrollUpButton,
  SelectScrollDownButton,
};
