import { PanelSettingsHeader } from "../../components/PanelSettingsHeader.jsx";
import { POPOVER_HEADER_CLASS, POPOVER_TITLE_CLASS } from "../../components/ui/surfaceStyles.js";

/** @param {{ title: any, onBack?: any, onReset?: any, resetIsDefault?: any, children: any }} props */
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
        <header className={POPOVER_HEADER_CLASS}>
          <h1 className={`min-w-0 flex-1 truncate px-1 ${POPOVER_TITLE_CLASS}`}>{title}</h1>
        </header>
      )}
      <div data-dock-editor-scroll className="min-h-0 flex-1 overflow-y-auto">
        <div data-dock-editor-content>{children}</div>
      </div>
    </section>
  );
}
