import { PanelSettingsHeader } from "../../components/PanelSettingsHeader.jsx";

export function DockEditorShell({ title, onBack, onReset, resetIsDefault = false, children }) {
  const hasNavigation = Boolean(onBack || onReset);

  return (
    <section
      data-dock-editor-shell
      className="flex max-h-screen min-h-0 min-w-full flex-col text-foreground"
    >
      {hasNavigation ? (
        <PanelSettingsHeader
          title={title}
          onBack={onBack}
          onReset={onReset}
          isDefault={resetIsDefault}
        />
      ) : (
        <header className="flex shrink-0 items-center gap-1 px-2 pb-1 pt-2">
          <h1 className="min-w-0 flex-1 truncate px-1 text-[10px] font-semibold tracking-wide text-muted-foreground">
            {title}
          </h1>
        </header>
      )}
      <div data-dock-editor-scroll className="min-h-0 flex-1 overflow-y-auto">
        <div data-dock-editor-content>{children}</div>
      </div>
    </section>
  );
}
