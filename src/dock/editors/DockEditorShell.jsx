import { ArrowLeft, RotateCcw, X } from "lucide-react";
import { IconButton } from "../../components/IconButton.jsx";

export function DockEditorShell({ title, onBack, onReset, onDone, children }) {
  return (
    <section className="flex h-full min-h-0 flex-col text-foreground">
      <header className="flex h-10 shrink-0 items-center gap-1 border-b border-border/60 px-2">
        {onBack ? (
          <IconButton icon={<ArrowLeft className="size-3.5" />} tip="Back" onClick={onBack} />
        ) : null}
        <h1 className="min-w-0 flex-1 truncate px-1 text-xs font-semibold">{title}</h1>
        {onReset ? (
          <IconButton icon={<RotateCcw className="size-3.5" />} tip="Reset" onClick={onReset} />
        ) : null}
        <IconButton icon={<X className="size-3.5" />} tip="Done" onClick={onDone} />
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </section>
  );
}
