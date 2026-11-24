import { useState } from "react";
import { ChevronRight, Ellipsis } from "lucide-react";
import {
  formatAudioDeviceLabel,
  isUnavailableApplicationSource,
} from "../lib/audioDeviceLabels.js";
import { cn } from "../lib/utils.js";
import { MenuRow } from "./ui/row";
import { AddButton } from "./AddButton.jsx";
import { IconAction } from "./ui/icon-action";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { InlineConfirm } from "./InlineConfirm.jsx";
import { isSourceMixId } from "../lib/sourceMixes.js";
import { useUiNavigationTarget, useUiSurface } from "../uiNavigation/UiNavigationContext.jsx";

/** @param {{ primary: string, secondary?: string, selected: boolean, onSelect: (...args: any[]) => any, ariaLabel: string, uiTarget?: string }} props */
function SourceRow({ primary, secondary, selected, onSelect, ariaLabel, uiTarget }) {
  return (
    <MenuRow
      aria-label={ariaLabel}
      aria-current={selected ? "true" : undefined}
      data-ui-target={uiTarget}
      onClick={onSelect}
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-1.5 shrink-0 rounded-full border",
          selected ? "border-primary bg-primary" : "border-muted-foreground bg-transparent"
        )}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-foreground">{primary}</span>
        {secondary ? (
          <span className="mt-0 block truncate text-muted-foreground">{secondary}</span>
        ) : null}
      </span>
    </MenuRow>
  );
}

function AudioDeviceOption({ device, selected, onSelect }) {
  const label = formatAudioDeviceLabel(device.label);
  return (
    <SourceRow
      uiTarget={`source:${device.id}`}
      ariaLabel={label.full}
      primary={label.primary}
      secondary={label.secondary}
      selected={selected}
      onSelect={onSelect}
    />
  );
}

function selectedDeviceSummary(devices, selectedId) {
  const selected = devices.find((device) => device.id === selectedId);
  if (!selected) return null;
  return formatAudioDeviceLabel(selected.label).primary;
}

function selectedApplicationSummary(applications, selectedId) {
  const selected = applications.find((application) => application.id === selectedId);
  return selected ? selected.label : null;
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
        className="gap-1"
      >
        <ChevronRight
          aria-hidden="true"
          className={cn(
            "size-[1em] shrink-0 text-muted-foreground transition-transform",
            open && "rotate-90"
          )}
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1 font-medium text-muted-foreground">
            {label}
            {selectedSummary ? (
              <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-primary" />
            ) : null}
          </span>
          {selectedSummary ? (
            <span className="mt-0 block truncate text-[length:var(--ui-fs-caption)] text-muted-foreground">
              {selectedSummary}
              <span className="sr-only">, selected</span>
            </span>
          ) : null}
        </span>
        <span className="shrink-0 text-[length:var(--ui-fs-caption)] tabular-nums text-muted-foreground">
          {count}
        </span>
      </MenuRow>
      <div
        id={id}
        aria-hidden={open ? undefined : true}
        inert={!open}
        className={cn("pl-3", !open && "pointer-events-none h-0 overflow-hidden opacity-0")}
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
              const unavailable = mix.members.filter(({ id }) => !available.has(id)).length;
              const count = unavailable
                ? `${unavailable} ${unavailable === 1 ? "Source" : "Sources"} Unavailable`
                : `${mix.members.length} Sources · Stereo`;
              return (
                <div key={mix.id} className="flex items-center gap-1">
                  <div className="min-w-0 flex-1">
                    <SourceRow
                      ariaLabel={mix.name}
                      primary={mix.name}
                      secondary={count}
                      selected={mix.id === safeAudioDeviceId}
                      onSelect={() => onSelect(mix.id)}
                    />
                  </div>
                  <Popover>
                    <PopoverTrigger asChild>
                      <IconAction aria-label={`manage ${mix.name}`}>
                        <Ellipsis className="size-[length:var(--ui-icon-management-action)]" />
                      </IconAction>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-auto p-1">
                      <MenuRow onClick={() => sourceMixes.open(mix)}>Edit</MenuRow>
                      <InlineConfirm
                        confirmLabel={`delete ${mix.name}`}
                        cancelLabel="cancel deletion"
                        onConfirm={() => void sourceMixes.remove(mix)}
                        trigger={(arm) => <MenuRow onClick={arm}>Delete</MenuRow>}
                      />
                    </PopoverContent>
                  </Popover>
                </div>
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
                selected={safeAudioDeviceId === device.id}
                onSelect={() => onSelect(device.id)}
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
                selected={safeAudioDeviceId === device.id}
                onSelect={() => onSelect(device.id)}
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
                ariaLabel={`${application.label} application audio`}
                primary={application.label}
                secondary={application.windowTitle}
                selected={safeAudioDeviceId === application.id}
                onSelect={() => onSelect(application.id)}
              />
            ))}
          </SourceSection>
        ) : null}
      </div>
      {sourceMixes?.supported ? (
        <div className="shrink-0 px-2 py-1">
          <AddButton label="Add Mix" onClick={() => sourceMixes.open()} />
        </div>
      ) : null}
    </>
  );
}
