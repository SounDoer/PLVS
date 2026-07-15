import { ArrowLeft, RotateCcw } from "lucide-react";
import { IconButton } from "../../components/IconButton.jsx";

export function DockEditorShell({ title, onBack, onReset, children }) {
  const hasNavigation = Boolean(onBack || onReset);

  return (
    <section
      data-dock-editor-shell
      className="flex max-h-screen min-h-0 min-w-full flex-col text-foreground"
    >
      <header
        className={`flex shrink-0 items-center gap-1 px-2 ${hasNavigation ? "border-b border-border/30 py-1" : "pb-1 pt-2"}`}
      >
        {onBack ? (
          <IconButton icon={<ArrowLeft className="size-3.5" />} tip="Back" onClick={onBack} />
        ) : null}
        <h1 className="min-w-0 flex-1 truncate px-1 text-[10px] font-semibold tracking-wide text-muted-foreground">
          {title}
        </h1>
        {onReset ? (
          <IconButton icon={<RotateCcw className="size-3.5" />} tip="Reset" onClick={onReset} />
        ) : null}
      </header>
      <div data-dock-editor-scroll className="min-h-0 flex-1 overflow-y-auto">
        <div data-dock-editor-content>{children}</div>
      </div>
    </section>
  );
}
