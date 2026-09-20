import { ArrowLeft, RotateCcw } from "lucide-react";
import { InlineConfirm } from "@/components/InlineConfirm.jsx";
import { ManagementIconAction } from "@/components/ManagementRow.jsx";
import { HoverTip } from "@/components/HoverTip.jsx";

export function PanelSettingsHeader({ title, onBack, onReset, isDefault = false }) {
  const resetLabel = `Reset ${title} settings`;

  return (
    <header
      data-panel-settings-header
      className="flex min-h-7 shrink-0 items-center gap-1 border-b border-border/30 px-1.5 py-1"
    >
      {onBack ? (
        <ManagementIconAction
          icon={<ArrowLeft className="size-[length:var(--ui-icon-management-action)]" />}
          label="Back"
          tip="Back"
          onClick={onBack}
        />
      ) : null}
      <h1 className="min-w-0 flex-1 truncate text-[length:var(--ui-fs-caption)] font-semibold tracking-wide text-muted-foreground">
        {title}
      </h1>
      {onReset ? (
        <div className="flex w-10 shrink-0 justify-end">
          <InlineConfirm
            className="w-10 justify-end"
            onConfirm={onReset}
            confirmLabel={`Confirm reset ${title} settings`}
            cancelLabel={`Cancel reset ${title} settings`}
            trigger={(arm) => (
              <HoverTip tip={isDefault ? "Using Defaults" : resetLabel} side="top" align="end">
                <ManagementIconAction
                  icon={<RotateCcw className="size-[length:var(--ui-icon-management-action)]" />}
                  label={resetLabel}
                  disabled={isDefault}
                  onClick={arm}
                />
              </HoverTip>
            )}
          />
        </div>
      ) : null}
    </header>
  );
}
