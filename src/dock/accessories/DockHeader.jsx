import { Bookmark, Focus, Volume2, Gauge, LayoutGrid, Trash2 } from "lucide-react";
import { IconButton } from "../../components/IconButton.jsx";
import { SourceTransportCluster } from "../../components/SourceTransportCluster.jsx";
import { HoverTip } from "../../components/HoverTip.jsx";
import { cn } from "../../lib/utils.js";
import { SHELL_HEADER_ACTIONS, SHELL_HEADER_BAR } from "../../lib/shellLayout.js";

const ACTION_ICON_CLASS = "size-[length:var(--ui-icon-shell-action)]";

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
      {/* Equal-width sides keep the transport on the window's centre line. */}
      <div className="min-w-0 flex-1" />
      <SourceTransportCluster
        state={state.sourceTransportState}
        sourceMode="live"
        sourceLocked
        onSourceModeChange={() => {}}
        onPrimaryAction={(actionKind) => onAction("source-primary", { actionKind })}
      />
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
