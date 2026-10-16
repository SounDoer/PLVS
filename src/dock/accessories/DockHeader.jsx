import {
  Bookmark,
  Check,
  CircleAlert,
  Download,
  Focus,
  Gauge,
  LayoutGrid,
  LoaderCircle,
  Trash2,
  Volume2,
} from "lucide-react";
import { IconButton } from "../../components/IconButton.jsx";
import { HoverTip } from "../../components/HoverTip.jsx";
import { LinkButton } from "../../components/ui/link-button.jsx";
import { cn } from "../../lib/utils.js";
import { SHELL_HEADER_ACTIONS, SHELL_HEADER_BAR } from "../../lib/shellLayout.js";

const ACTION_ICON_CLASS = "size-[length:var(--ui-icon-shell-action)]";
const UPDATE_ICONS = {
  available: Download,
  downloading: LoaderCircle,
  ready: Check,
  error: CircleAlert,
};

/** @param {{ state: any, onAction: (...args: any[]) => any }} props */
export function DockHeader({ state, onAction }) {
  if (!state) return null;
  const toolTipProps = /** @type {const} */ ({ tipSide: "left", tipAlign: "center" });
  const toggleEditor = (/** @type {string} */ view, event) => {
    const actionType = state.editorView === view ? "close-editor" : "open-editor";
    if (actionType === "close-editor") onAction(actionType);
    else {
      const rect = event.currentTarget.getBoundingClientRect();
      onAction(actionType, { view, anchorX: rect.left + rect.width / 2 });
    }
  };
  return (
    <div
      data-testid="dock-header"
      data-visual-capture-surface="dockHeader"
      data-visual-capture-ready="true"
      className={cn(
        SHELL_HEADER_BAR,
        // A window-wide bar against the screen edge, not a card inside a padded shell.
        "h-screen w-screen select-none px-[var(--ui-header-pad-x)] text-foreground"
      )}
    >
      <div data-testid="dock-header-trailing" className="flex min-w-0 flex-1 items-center gap-3">
        {state.notice ? (
          <HoverTip
            tip={state.notice.details ?? state.notice.text}
            side="left"
            align="center"
            className="min-w-0 max-w-[40vw]"
            tipClassName="w-max max-w-[calc(100vw-1rem)] overflow-hidden text-ellipsis whitespace-nowrap"
          >
            <span
              className={cn(
                "block truncate text-[length:var(--ui-fs-status)] font-medium",
                state.notice.kind === "error"
                  ? "text-[color:var(--ui-feedback-danger)]"
                  : "text-muted-foreground"
              )}
            >
              {state.notice.text}
            </span>
          </HoverTip>
        ) : null}
        <div className="flex-1" />
        {state.update ? <DockHeaderUpdate update={state.update} onAction={onAction} /> : null}
        <div data-testid="dock-header-actions" className={cn(SHELL_HEADER_ACTIONS, "shrink-0")}>
          <IconButton
            icon={<Trash2 className={ACTION_ICON_CLASS} />}
            tip="Clear"
            {...toolTipProps}
            disabled={state.clearDisabled}
            onClick={() => onAction("clear")}
          />
          <IconButton
            icon={<Volume2 className={ACTION_ICON_CLASS} />}
            tip="Device"
            {...toolTipProps}
            aria-pressed={state.editorView === "device"}
            className={state.editorView === "device" ? "bg-ui-hover text-foreground" : undefined}
            onClick={(event) => toggleEditor("device", event)}
          />
          <IconButton
            icon={<Gauge className={ACTION_ICON_CLASS} />}
            tip="Loudness Profile"
            {...toolTipProps}
            aria-pressed={state.editorView === "loudness-profile"}
            className={cn(
              state.editorView === "loudness-profile" ? "bg-ui-hover text-foreground" : undefined
            )}
            onClick={(event) => toggleEditor("loudness-profile", event)}
          />
          <IconButton
            icon={<LayoutGrid className={ACTION_ICON_CLASS} />}
            tip="Edit modules"
            {...toolTipProps}
            aria-pressed={state.editorView === "modules"}
            className={state.editorView === "modules" ? "bg-ui-hover text-foreground" : undefined}
            onClick={(event) => toggleEditor("modules", event)}
          />
          <IconButton
            icon={<Focus className={ACTION_ICON_CLASS} />}
            tip="Views"
            {...toolTipProps}
            aria-pressed={state.editorView === "views"}
            className={state.editorView === "views" ? "bg-ui-hover text-foreground" : undefined}
            onClick={(event) => toggleEditor("views", event)}
          />
          <IconButton
            icon={<Bookmark className={ACTION_ICON_CLASS} />}
            tip="Presets"
            {...toolTipProps}
            aria-pressed={state.editorView === "presets"}
            className={cn(
              state.editorView === "presets" ? "bg-ui-hover text-foreground" : undefined
            )}
            onClick={(event) => toggleEditor("presets", event)}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * Dock's update entry: the strip shows only a badge, so the toolbar names the state in words,
 * like the normal window's footer link, with the same LinkButton. It opens the shared update details.
 *
 * @param {{ update: { phase: string, text: string }, onAction: (...args: any[]) => any }} props
 */
function DockHeaderUpdate({ update, onAction }) {
  const Icon = UPDATE_ICONS[update.phase] ?? Download;
  return (
    <LinkButton
      data-testid="dock-header-update"
      data-phase={update.phase}
      onClick={() => onAction("open-update")}
      className={cn(
        "flex shrink-0 items-center gap-1 text-[length:var(--ui-fs-status)] font-medium hover:underline",
        update.phase === "error"
          ? "text-[color:var(--ui-feedback-danger)] hover:text-[color:var(--ui-feedback-danger)]"
          : update.phase === "downloading"
            ? "text-muted-foreground"
            : "text-primary hover:text-primary"
      )}
    >
      <Icon aria-hidden="true" className="size-[1.1em]" />
      <span className="tabular-nums">{update.text}</span>
    </LinkButton>
  );
}
