import { useId } from "react";
import { ChevronRight, Lock } from "lucide-react";
import { CHANNEL_ROLE_VOCABULARY } from "../math/channelRoles.js";
import { layoutsForChannelCount } from "../math/channelLayoutTable.js";
import { cn } from "../lib/utils.js";
import { useDropdownNavigation } from "../uiNavigation/useDropdownNavigation.js";
import { useUiNavigationTarget, useUiSurface } from "../uiNavigation/UiNavigationContext.jsx";
import { ResetAction } from "./ResetAction.jsx";
import { MenuRow } from "./ui/row";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

export function SourceChannels({
  channelCount,
  roles,
  layoutId,
  locked,
  hasOverride,
  expanded,
  onExpandedChange,
  onLayout,
  onRole,
  onReset,
}) {
  const contentId = useId();
  const layouts = layoutsForChannelCount(channelCount);
  const label =
    layouts.find(({ id }) => id === layoutId)?.name ??
    (layoutId === "custom" ? "Custom" : "Unknown");
  const canChooseLayout = !locked && layouts.some(({ id }) => id !== layoutId);
  const dropdown = useDropdownNavigation(
    expanded && canChooseLayout ? "setting:channels.layout" : null
  );
  useUiNavigationTarget("sourceGroup:channels", { show: () => onExpandedChange(true) });
  useUiSurface({
    active: expanded,
    kind: "sourceGroup",
    origin: "navigable",
    blocking: false,
    dismissible: true,
    supportedActions: ["close"],
    target: { group: "channels" },
    onClose: () => onExpandedChange(false),
  });
  return (
    <section className="mb-1 shrink-0 border-b border-border pb-1">
      <MenuRow
        data-ui-target="source-group:channels"
        aria-expanded={expanded}
        aria-controls={contentId}
        onClick={() => onExpandedChange(!expanded)}
      >
        <span aria-hidden="true" className="grid w-[1em] shrink-0 place-items-center">
          <ChevronRight
            className={cn(
              "size-[1em] text-muted-foreground transition-transform",
              expanded && "rotate-90"
            )}
          />
        </span>
        <span className="font-medium">Channels</span>
        {channelCount > 0 ? (
          <span className="ml-auto flex items-center gap-1 text-muted-foreground tabular-nums">
            {locked ? (
              <>
                <Lock aria-hidden="true" className="size-[1em]" />
                <span className="sr-only">Read-only. Channel roles follow the Mix format.</span>
              </>
            ) : null}
            {channelCount}ch · {label}
          </span>
        ) : null}
      </MenuRow>
      <div
        id={contentId}
        hidden={!expanded}
        className="max-h-[calc(var(--radix-popover-content-available-height)*0.45)] overflow-y-auto overscroll-contain pb-1 pl-7 pr-2"
      >
        {canChooseLayout ? (
          <div className="flex min-h-[var(--ui-control-h)] items-center justify-between gap-2">
            <span>Layout</span>
            <Select value={layoutId ?? ""} onValueChange={onLayout} {...dropdown.rootProps}>
              <SelectTrigger variant="flush" aria-label="channel layout" {...dropdown.triggerProps}>
                <SelectValue placeholder="Unknown" />
              </SelectTrigger>
              <SelectContent position="popper" variant="flush">
                {layouts.map(({ id, name }) => (
                  <SelectItem key={id} value={id}>
                    {name}
                  </SelectItem>
                ))}
                {layoutId === "custom" ? <SelectItem value="custom">Custom</SelectItem> : null}
              </SelectContent>
            </Select>
          </div>
        ) : null}
        {roles.map((role, index) => (
          <div
            key={index}
            className="flex min-h-[var(--ui-control-h)] items-center justify-between gap-2"
          >
            <span className="font-mono tabular-nums text-muted-foreground">{index + 1}</span>
            <Select value={role} disabled={locked} onValueChange={(value) => onRole(index, value)}>
              <SelectTrigger
                variant="flush"
                aria-label={`channel ${index + 1} role`}
                data-ui-target={`setting:channels.role.${index + 1}`}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" variant="flush">
                {CHANNEL_ROLE_VOCABULARY.map(({ id, label }) => (
                  <SelectItem key={id} value={id}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ))}
        {channelCount === 0 ? (
          <span className="text-muted-foreground">No Channels Detected</span>
        ) : null}
        {hasOverride && !locked ? (
          <div className="flex min-h-[var(--ui-control-h)] items-center justify-end">
            <ResetAction
              label="Reset channel labels"
              data-ui-target="setting:channels.resetLabels"
              isDefault={false}
              onReset={onReset}
              confirmLabel="Confirm reset channel labels"
              cancelLabel="Cancel reset channel labels"
            />
          </div>
        ) : null}
      </div>
    </section>
  );
}
