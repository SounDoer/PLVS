import { ArrowLeft } from "lucide-react";
import { ManagementIconAction } from "@/components/ManagementRow.jsx";
import { ResetAction } from "@/components/ResetAction.jsx";
import { POPOVER_HEADER_CLASS, POPOVER_TITLE_CLASS } from "@/components/ui/surfaceStyles.js";

/** @param {{ title: any, onBack?: (...args: any[]) => any, onReset?: (...args: any[]) => any, isDefault?: boolean }} props */
export function PanelSettingsHeader({ title, onBack, onReset, isDefault = false }) {
  const resetLabel = `Reset ${title} settings`;

  return (
    <header data-panel-settings-header className={POPOVER_HEADER_CLASS}>
      {onBack ? (
        <ManagementIconAction
          icon={<ArrowLeft className="size-[length:var(--ui-icon-management-action)]" />}
          label="Back"
          tip="Back"
          onClick={onBack}
        />
      ) : null}
      <h1 className={`min-w-0 flex-1 truncate ${POPOVER_TITLE_CLASS}`}>{title}</h1>
      {onReset ? (
        <ResetAction
          label={resetLabel}
          onReset={onReset}
          isDefault={isDefault}
          confirmLabel={`Confirm reset ${title} settings`}
          cancelLabel={`Cancel reset ${title} settings`}
        />
      ) : null}
    </header>
  );
}
