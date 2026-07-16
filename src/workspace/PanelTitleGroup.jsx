import { PANEL_HEADER_TITLE_GROUP } from "@/lib/shellLayout";
import { cn } from "@/lib/utils";

export function PanelTitleGroup({ icon: Icon, title, className, ...props }) {
  return (
    <div data-panel-title-group className={cn(PANEL_HEADER_TITLE_GROUP, className)} {...props}>
      {Icon ? (
        <span data-panel-title-icon className="flex shrink-0">
          <Icon className="size-[length:var(--ui-icon-panel-module)]" />
        </span>
      ) : null}
      <span className="truncate max-w-[8rem]">{title}</span>
    </div>
  );
}
