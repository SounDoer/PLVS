import { useState } from "react";
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
import { isSourceMixId, mixInputAvailable, sourceMixMemberCount } from "../lib/sourceMixes.js";
import {
  deviceChannelChoices,
  findDeviceSource,
  splitChannelSource,
} from "../lib/channelSources.js";
import { IconAction } from "./ui/icon-action";
import { useUiNavigationTarget, useUiSurface } from "../uiNavigation/UiNavigationContext.jsx";

const SOURCE_LEADING_CLASS = "grid w-[1em] shrink-0 place-items-center";

/** @param {{ primary: string, secondary?: import("react").ReactNode, selected: boolean, onSelect: (...args: any[]) => any, ariaLabel: string, uiTarget?: string, actions?: import("react").ReactNode, showActions?: boolean, stretchActions?: boolean, tip?: string }} props */
function SourceRow({
  primary,
  secondary,
  selected,
  onSelect,
  ariaLabel,
  uiTarget,
  actions,
  showActions,
  stretchActions,
  tip,
}) {
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
      <span
        className={cn(
          MANAGEMENT_ROW_ACTIONS_CLASS,
          showActions && "opacity-100",
          stretchActions && "self-stretch"
        )}
      >
        {actions}
      </span>
    </div>
  );
}

function AudioDeviceOption({ device, selectedId, onSelect }) {
  const choices = deviceChannelChoices(device);
  const selectedChannel = choices.find(({ id }) => id === selectedId);
  const [open, setOpen] = useState(Boolean(selectedChannel));
  const label = formatAudioDeviceLabel(device.label);
  const listId = `source-channels-${device.id}`;
  const channelDetail = [
    choices.length > 0
      ? `${choices.length} ${choices.length === 1 ? "Channel" : "Channels"}`
      : null,
    !open ? selectedChannel?.label : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <>
      <SourceRow
        uiTarget={`source:${device.id}`}
        ariaLabel={label.full}
        primary={label.primary}
        secondary={
          channelDetail ? (
            <span className="flex min-w-0 items-center gap-1">
              {label.secondary ? (
                <>
                  <span className="min-w-0 truncate">{label.secondary}</span>
                  <span aria-hidden="true">·</span>
                </>
              ) : null}
              <span className="shrink-0">{channelDetail}</span>
            </span>
          ) : (
            label.secondary
          )
        }
        selected={device.id === selectedId}
        onSelect={() => onSelect(device.id)}
        showActions={open}
        stretchActions
        actions={
          choices.length > 0 ? (
            <IconAction
              className="grid w-10 place-items-center self-stretch"
              aria-label={`channels for ${label.full}`}
              aria-expanded={open}
              aria-controls={listId}
              onClick={() => setOpen(!open)}
            >
              <ChevronRight className={cn("size-[1em]", open && "rotate-90")} />
            </IconAction>
          ) : null
        }
      />
      {choices.length > 0 ? (
        <div id={listId} hidden={!open} className="pl-4">
          {open &&
            choices.map((choice) => (
              <SourceRow
                key={choice.id}
                uiTarget={`source:${choice.id}`}
                ariaLabel={`${label.full} · ${choice.label}`}
                primary={choice.label}
                selected={choice.id === selectedId}
                onSelect={() => onSelect(choice.id)}
              />
            ))}
        </div>
      ) : null}
    </>
  );
}

function selectedDeviceSummary(devices, selectedId) {
  const selected = findDeviceSource(devices, selectedId);
  if (!selected) return null;
  if (selected.channelLabel) {
    return `${formatAudioDeviceLabel(devices.find(({ id }) => id === selected.parentId).label).primary} · ${selected.channelLabel}`;
  }
  return formatAudioDeviceLabel(selected.label).primary;
}

function selectedApplicationSummary(applications, selectedId) {
  const selected = applications.find((application) => application.id === selectedId);
  return selected ? applicationSourceName(selected) : null;
}

function SourceSection({ id, group, label, count, open, onOpenChange, selectedSummary, children }) {
  const navigable = group !== "mixes";
  // `ui show source-group` expands a group as clicking its heading does.
  useUiNavigationTarget(navigable ? `sourceGroup:${group}` : null, {
    show: () => onOpenChange(true),
  });
  useUiSurface({
    active: open && navigable,
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
  sourceMixes = null,
  onSelect,
}) {
  const [sourceSectionsOpen, setSourceSectionsOpen] = useState({
    output: splitChannelSource(safeAudioDeviceId)?.deviceId.startsWith("lb-") ?? false,
    input: splitChannelSource(safeAudioDeviceId)?.deviceId.startsWith("cap-") ?? false,
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
                Number(Boolean(mix.input && !mixInputAvailable(mix.input, audioInputs)));
              const count = unavailable
                ? `${unavailable} ${unavailable === 1 ? "Source" : "Sources"} Unavailable`
                : `${sourceMixMemberCount(mix)} Sources · Stereo`;
              return (
                <SourceRow
                  key={mix.id}
                  uiTarget={`source:${mix.id}`}
                  ariaLabel={mix.name}
                  primary={mix.name}
                  secondary={count}
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
      </div>
      {canManageMixes ? (
        <div className="shrink-0 px-2 py-1">
          <AddButton label="Add Mix" onClick={() => sourceMixes.open()} />
        </div>
      ) : null}
    </>
  );
}
