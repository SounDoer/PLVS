import { useState } from "react";
import { mixInputs, resolveMixFormat } from "../lib/mixRouting.js";
import { ChevronRight, SlidersHorizontal, Trash2 } from "lucide-react";
import {
  applicationSourceName,
  applicationWindowContext,
  formatAudioDeviceLabel,
  isUnavailableApplicationSource,
} from "../lib/audioDeviceLabels.js";
import { cn } from "../lib/utils.js";
import { MenuRow, RowAction } from "./ui/row";
import { AddButton } from "./AddButton.jsx";
import { useHoverTip } from "./HoverTip.jsx";
import { InlineConfirm } from "./InlineConfirm.jsx";
import {
  MANAGEMENT_ROW_ACTIONS_CLASS,
  MANAGEMENT_ROW_CLASS,
  ManagementIconAction,
} from "./ManagementRow.jsx";
import {
  isMixOutputDevice,
  isSourceMixId,
  mixInputAvailable,
  sourceMixMemberCount,
} from "../lib/sourceMixes.js";
import { useUiNavigationTarget, useUiSurface } from "../uiNavigation/UiNavigationContext.jsx";

const SOURCE_LEADING_CLASS = "grid w-[1em] shrink-0 place-items-center";

/** @param {{ primary: string, secondary?: string, selected: boolean, onSelect: (...args: any[]) => any, ariaLabel: string, uiTarget?: string, actions?: import("react").ReactNode, tip?: string }} props */
function SourceRow({ primary, secondary, selected, onSelect, ariaLabel, uiTarget, actions, tip }) {
  const { anchorRef, showTip, hideTip, tipNode } = useHoverTip({ tip, align: "start" });
  const Row = actions ? RowAction : MenuRow;
  const row = (
    <Row
      ref={anchorRef}
      onMouseEnter={tip ? showTip : undefined}
      onMouseLeave={tip ? hideTip : undefined}
      onFocus={tip ? showTip : undefined}
      onBlur={tip ? hideTip : undefined}
      aria-label={ariaLabel}
      aria-current={selected ? "true" : undefined}
      data-ui-target={uiTarget}
      onClick={onSelect}
      className={actions ? "py-1" : undefined}
    >
      <span aria-hidden="true" className={SOURCE_LEADING_CLASS}>
        <span
          className={cn(
            "size-1.5 rounded-full border",
            selected ? "border-primary bg-primary" : "border-muted-foreground bg-transparent"
          )}
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-foreground">{primary}</span>
        {secondary ? (
          <span className="mt-0 block truncate text-muted-foreground">{secondary}</span>
        ) : null}
      </span>
    </Row>
  );
  if (!actions)
    return tip ? (
      <>
        {row}
        {tipNode}
      </>
    ) : (
      row
    );
  return (
    <div className={MANAGEMENT_ROW_CLASS}>
      {row}
      <span className={MANAGEMENT_ROW_ACTIONS_CLASS}>{actions}</span>
    </div>
  );
}

function AudioDeviceOption({ device, selectedId, onSelect }) {
  const label = formatAudioDeviceLabel(device.label);
  return (
    <SourceRow
      uiTarget={`source:${device.id}`}
      ariaLabel={label.full}
      primary={label.primary}
      secondary={label.secondary}
      selected={device.id === selectedId}
      onSelect={() => onSelect(device.id)}
    />
  );
}

function selectedDeviceSummary(devices, selectedId) {
  const selected = devices.find(({ id }) => id === selectedId);
  return selected ? formatAudioDeviceLabel(selected.label).primary : null;
}

function selectedApplicationSummary(applications, selectedId) {
  const selected = applications.find((application) => application.id === selectedId);
  return selected ? applicationSourceName(selected) : null;
}

function SourceSection({ id, group, label, count, open, onOpenChange, selectedSummary, children }) {
  // `ui show source-group` expands a group as clicking its heading does.
  useUiNavigationTarget(`sourceGroup:${group}`, {
    show: () => onOpenChange(true),
  });
  useUiSurface({
    active: open,
    kind: "sourceGroup",
    origin: "navigable",
    blocking: false,
    dismissible: true,
    supportedActions: ["close"],
    target: { group },
    onClose: () => onOpenChange(false),
  });
  return (
    <section>
      <MenuRow
        data-ui-target={`source-group:${group}`}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => onOpenChange(!open)}
      >
        <span aria-hidden="true" className={SOURCE_LEADING_CLASS}>
          <ChevronRight
            className={cn(
              "size-[1em] text-muted-foreground transition-transform",
              open && "rotate-90"
            )}
          />
        </span>
        <span className="shrink-0 font-medium text-muted-foreground">{label}</span>
        {!open && selectedSummary ? (
          <>
            <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-primary" />
            <span className="min-w-0 truncate text-foreground">
              {selectedSummary}
              <span className="sr-only">, selected</span>
            </span>
          </>
        ) : null}
        <span className="ml-auto shrink-0 text-[length:var(--ui-fs-caption)] tabular-nums text-muted-foreground">
          {count}
        </span>
      </MenuRow>
      <div
        id={id}
        aria-hidden={open ? undefined : true}
        inert={!open}
        className={cn(!open && "pointer-events-none h-0 overflow-hidden opacity-0")}
      >
        {children}
      </div>
    </section>
  );
}

/** Shared device and application selection; the caller owns capture and errors. */
export function DeviceSelectionContent({
  audioOutputs = [],
  audioInputs = [],
  captureApplications = [],
  safeAudioDeviceId = "default",
  defaultOutputReference = undefined,
  sourceMixes = null,
  onSelect,
}) {
  const [sourceSectionsOpen, setSourceSectionsOpen] = useState({
    output: false,
    input: false,
    applications: false,
    mixes: isSourceMixId(safeAudioDeviceId),
  });

  const setSourceSectionOpen = (/** @type {string} */ section, open) => {
    setSourceSectionsOpen((current) => ({ ...current, [section]: open }));
  };

  const selectedOutputSummary = selectedDeviceSummary(audioOutputs, safeAudioDeviceId);
  const selectedInputSummary = selectedDeviceSummary(audioInputs, safeAudioDeviceId);
  const selectedApplication = selectedApplicationSummary(captureApplications, safeAudioDeviceId);
  const selectedMix = sourceMixes?.list.find((mix) => mix.id === safeAudioDeviceId);
  const canManageMixes = sourceMixes?.supported && sourceMixes.open && sourceMixes.remove;
  const available = new Set(captureApplications.map(({ id }) => id));

  return (
    <>
      <SourceRow
        uiTarget="source:default"
        ariaLabel="Automatic"
        primary="Automatic"
        selected={safeAudioDeviceId === "default"}
        onSelect={() => onSelect("default")}
      />
      {isUnavailableApplicationSource(safeAudioDeviceId, captureApplications) ? (
        <p className="px-2 py-1 text-[length:var(--ui-fs-caption)] text-muted-foreground">
          Selected Application Unavailable
        </p>
      ) : null}
      {sourceMixes?.supported && isSourceMixId(safeAudioDeviceId) && !selectedMix ? (
        <p className="px-2 py-1 text-[length:var(--ui-fs-caption)] text-muted-foreground">
          Selected Mix Unavailable
        </p>
      ) : null}
      <div
        data-source-scroll
        className="min-h-0 overflow-x-hidden overflow-y-auto overscroll-contain [scrollbar-gutter:stable]"
      >
        {audioOutputs.length ? (
          <SourceSection
            id="source-output-list"
            group="output"
            label="Output"
            count={audioOutputs.length}
            open={sourceSectionsOpen.output}
            onOpenChange={(open) => setSourceSectionOpen("output", open)}
            selectedSummary={selectedOutputSummary}
          >
            {audioOutputs.map((device) => (
              <AudioDeviceOption
                key={device.id}
                device={device}
                selectedId={safeAudioDeviceId}
                onSelect={onSelect}
              />
            ))}
          </SourceSection>
        ) : null}
        {audioInputs.length ? (
          <SourceSection
            id="source-input-list"
            group="input"
            label="Input"
            count={audioInputs.length}
            open={sourceSectionsOpen.input}
            onOpenChange={(open) => setSourceSectionOpen("input", open)}
            selectedSummary={selectedInputSummary}
          >
            {audioInputs.map((device) => (
              <AudioDeviceOption
                key={device.id}
                device={device}
                selectedId={safeAudioDeviceId}
                onSelect={onSelect}
              />
            ))}
          </SourceSection>
        ) : null}
        {captureApplications.length ? (
          <SourceSection
            id="source-application-list"
            group="applications"
            label="Applications"
            count={captureApplications.length}
            open={sourceSectionsOpen.applications}
            onOpenChange={(open) => setSourceSectionOpen("applications", open)}
            selectedSummary={selectedApplication}
          >
            {captureApplications.map((application) => (
              <SourceRow
                key={application.id}
                uiTarget={`source:${application.id}`}
                ariaLabel={`${applicationSourceName(application)} application audio`}
                primary={applicationSourceName(application)}
                tip={applicationWindowContext(application)}
                selected={safeAudioDeviceId === application.id}
                onSelect={() => onSelect(application.id)}
              />
            ))}
          </SourceSection>
        ) : null}
        {sourceMixes?.supported && sourceMixes.list.length ? (
          <SourceSection
            id="source-mixes-list"
            group="mixes"
            label="Mixes"
            count={sourceMixes.list.length}
            open={sourceSectionsOpen.mixes}
            onOpenChange={(open) => setSourceSectionOpen("mixes", open)}
            selectedSummary={selectedMix?.name}
          >
            {sourceMixes.list.map((mix) => {
              const unavailable =
                mix.members.filter(({ id }) => !available.has(id)).length +
                mixInputs(mix).filter((input) => !mixInputAvailable(input, audioInputs)).length +
                Number(
                  Boolean(
                    mix.output &&
                    !audioOutputs.some(
                      (device) => device.id === mix.output.id && isMixOutputDevice(device)
                    )
                  )
                );
              const members = sourceMixMemberCount(mix);
              const count = unavailable || members;
              const detail = `${count} ${count === 1 ? "Source" : "Sources"} ${unavailable ? "Unavailable" : `· ${resolveMixFormat(mix, audioOutputs, defaultOutputReference).name}`}`;
              return (
                <SourceRow
                  key={mix.id}
                  uiTarget={`source:${mix.id}`}
                  ariaLabel={mix.name}
                  primary={mix.name}
                  secondary={detail}
                  selected={mix.id === safeAudioDeviceId}
                  onSelect={() => onSelect(mix.id)}
                  actions={
                    canManageMixes ? (
                      <>
                        <ManagementIconAction
                          label={`edit ${mix.name}`}
                          tip="Edit"
                          icon={
                            <SlidersHorizontal className="size-[length:var(--ui-icon-management-action)]" />
                          }
                          onClick={() => sourceMixes.open(mix)}
                        />
                        <InlineConfirm
                          confirmLabel={`confirm delete ${mix.name}`}
                          cancelLabel={`cancel delete ${mix.name}`}
                          onConfirm={() => void sourceMixes.remove(mix)}
                          trigger={(arm) => (
                            <ManagementIconAction
                              label={`delete ${mix.name}`}
                              tip="Delete"
                              icon={
                                <Trash2 className="size-[length:var(--ui-icon-management-action)]" />
                              }
                              onClick={() => arm()}
                              className="hover:text-destructive"
                            />
                          )}
                        />
                      </>
                    ) : null
                  }
                />
              );
            })}
          </SourceSection>
        ) : null}
      </div>
      {canManageMixes ? (
        <div className="shrink-0 px-2 py-1">
          <AddButton label="Add Mix" onClick={() => sourceMixes.open()} />
        </div>
      ) : null}
    </>
  );
}
