import { ArrowLeft } from "lucide-react";
import { ManagementIconAction } from "@/components/ManagementRow.jsx";
import { ResetAction } from "@/components/ResetAction.jsx";

export function PanelSettingsHeader({ title, onBack, onReset, isDefault = false }) {
  const resetLabel = `Reset ${title} settings`;

  return (
    <header
      data-panel-settings-header
      className="flex min-h-7 shrink-0 items-center gap-1 border-b border-border px-1.5 py-1"
    >
      {onBack ? (
        <ManagementIconAction
          icon={<ArrowLeft className="size-[length:var(--ui-icon-management-action)]" />}
          label="Back"
          tip="Back"
          onClick={onBack}
        />
      ) : null}
      <h1 className="min-w-0 flex-1 truncate text-[length:var(--ui-fs-panel-title)] font-semibold text-foreground">
        {title}
      </h1>
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
