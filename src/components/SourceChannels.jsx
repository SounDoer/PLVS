import { useId, useRef } from "react";
import { ChevronDown, ChevronRight, Lock } from "lucide-react";
import { CHANNEL_ROLE_VOCABULARY } from "../math/channelRoles.js";
import { layoutsForChannelCount } from "../math/channelLayoutTable.js";
import { cn } from "../lib/utils.js";
import { useDropdownNavigation } from "../uiNavigation/useDropdownNavigation.js";
import { useUiNavigationTarget, useUiSurface } from "../uiNavigation/UiNavigationContext.jsx";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { MenuRow } from "./ui/row";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

export function SourceChannels({
  channelCount,
  roles,
  layoutId,
  locked,
  canReset,
  expanded,
  onExpandedChange,
  onLayout,
  onRole,
  onReset,
}) {
  const contentId = useId();
  const disclosureRef = useRef(null);
  const layouts = layoutsForChannelCount(channelCount);
  const label =
    layouts.find(({ id }) => id === layoutId)?.name ??
    (layoutId === "custom" ? "Custom" : "Unknown");
  const alternatives = layouts.filter(({ id }) => id !== layoutId);
  const showLayoutMenu = !locked && (alternatives.length > 0 || canReset);
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
      <div className="flex items-center">
        <MenuRow
          ref={disclosureRef}
          className="min-w-0 flex-1"
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
          {channelCount > 0 && !showLayoutMenu ? (
            <span className="ml-auto flex shrink-0 items-center gap-1 whitespace-nowrap text-muted-foreground tabular-nums">
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
        {showLayoutMenu ? (
          <SourceLayoutMenu
            summary={`${channelCount}ch · ${label}`}
            alternatives={alternatives}
            canReset={canReset}
            onLayout={onLayout}
            onReset={onReset}
            disclosureRef={disclosureRef}
          />
        ) : null}
      </div>
      <div
        id={contentId}
        hidden={!expanded}
        className="max-h-[calc(var(--radix-popover-content-available-height)*0.45)] overflow-y-auto overscroll-contain pb-1 pl-7 pr-2"
      >
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
      </div>
    </section>
  );
}

function SourceLayoutMenu({ summary, alternatives, canReset, onLayout, onReset, disclosureRef }) {
  const dropdown = useDropdownNavigation("setting:channels.layout");
  const activating = useRef(false);
  const keyboardOpen = useRef(false);
  const activate = (action) => {
    activating.current = true;
    dropdown.rootProps.onOpenChange(false);
    action();
  };
  return (
    <Popover {...dropdown.rootProps}>
      <PopoverTrigger asChild>
        <MenuRow
          className="w-auto shrink-0 gap-1 whitespace-nowrap text-muted-foreground tabular-nums"
          aria-label={`Channel layout: ${summary}`}
          data-channel-layout-trigger=""
          onClick={(event) => {
            keyboardOpen.current = event.detail === 0;
          }}
          {...dropdown.triggerProps}
        >
          {summary}
          <ChevronDown aria-hidden="true" className="size-[1em]" />
        </MenuRow>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        aria-label="Channel Layout"
        className="w-max min-w-[var(--radix-popover-trigger-width)] p-1"
        data-dock-editor-menu=""
        onOpenAutoFocus={(event) => {
          if (!keyboardOpen.current) event.preventDefault();
          keyboardOpen.current = false;
        }}
        onCloseAutoFocus={(event) => {
          if (!activating.current) return;
          activating.current = false;
          event.preventDefault();
          disclosureRef.current?.focus();
        }}
      >
        {alternatives.map(({ id, name }) => (
          <MenuRow
            key={id}
            className="whitespace-nowrap"
            onClick={() => activate(() => onLayout(id))}
          >
            {name}
          </MenuRow>
        ))}
        {alternatives.length > 0 ? <hr className="my-1 border-border" /> : null}
        <MenuRow
          data-ui-target="setting:channels.resetLabels"
          disabled={!canReset}
          className="disabled:opacity-50 disabled:hover:bg-transparent"
          onClick={() => activate(onReset)}
        >
          Reset
        </MenuRow>
      </PopoverContent>
    </Popover>
  );
}
