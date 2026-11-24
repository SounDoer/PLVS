import { useId, useLayoutEffect, useRef, useState } from "react";
import { ChevronRight, Pencil } from "lucide-react";
import { useFloatingPanelDrag } from "../hooks/useFloatingPanelDrag.js";
import {
  applicationSourceName,
  applicationWindowContext,
  formatAudioDeviceLabel,
} from "../lib/audioDeviceLabels.js";
import {
  canSaveSourceMix,
  isMixInputId,
  isMixOutputDevice,
  sourceMixName,
} from "../lib/sourceMixes.js";
import { cn } from "../lib/utils.js";
import { useUiSurface } from "../uiNavigation/UiNavigationContext.jsx";
import { useHoverTip } from "./HoverTip.jsx";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { IconAction } from "./ui/icon-action";
import { MenuRow } from "./ui/row";
import { FLOATING_EDITOR_CLASS } from "./ui/surfaceStyles.js";

function MixGroup({ label, open, onToggle, count, unavailable = false, children }) {
  const contentId = useId();
  return (
    <section>
      <MenuRow aria-expanded={open} aria-controls={contentId} onClick={onToggle}>
        <ChevronRight
          aria-hidden="true"
          className={cn("size-[1em] shrink-0 text-muted-foreground", open && "rotate-90")}
        />
        <span className="min-w-0 flex-1 truncate">{label}</span>{" "}
        {unavailable || (!open && count > 0) ? (
          <span className="shrink-0 text-[length:var(--ui-fs-caption)] text-muted-foreground">
            {unavailable ? "Unavailable" : `${count} Selected`}
          </span>
        ) : null}
      </MenuRow>
      <div id={contentId} hidden={!open} className="pl-4">
        {open && children}
      </div>
    </section>
  );
}

function MixCheckRow({ label, checked, onChange, unavailable = false, tip = undefined }) {
  const { anchorRef, showTip, hideTip, tipNode } = useHoverTip({ tip, align: "start" });
  return (
    <label
      ref={anchorRef}
      onMouseEnter={tip ? showTip : undefined}
      onMouseLeave={tip ? hideTip : undefined}
      onFocus={tip ? showTip : undefined}
      onBlur={tip ? hideTip : undefined}
      className="flex min-h-[var(--ui-row-h)] cursor-pointer items-center gap-2 rounded-xs px-2 hover:bg-ui-hover focus-within:bg-ui-hover"
    >
      <Checkbox checked={checked} onChange={onChange} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {unavailable ? <span className="shrink-0 text-muted-foreground">Unavailable</span> : null}
      {tipNode}
    </label>
  );
}

export function SourceMixEditor({ owner, applications, inputs = [], outputs = [] }) {
  const { draft, saving, rename, cancel, save, toggle, toggleInputChannel, toggleOutput } = owner;
  const ref = useRef(null);
  const [position, setPosition] = useState(null);
  const [renaming, setRenaming] = useState(false);
  const [inputOpen, setInputOpen] = useState(Boolean(draft.input));
  const [outputOpen, setOutputOpen] = useState(Boolean(draft.output));
  const [applicationsOpen, setApplicationsOpen] = useState(draft.members.length > 0);
  const [expandedDevice, setExpandedDevice] = useState(draft.input?.id ?? null);
  const originalName = useRef("");
  const drag = useFloatingPanelDrag(ref, setPosition);
  useLayoutEffect(() => ref.current?.focus(), []);

  const available = new Set(applications.map(({ id }) => id));
  const checked = new Set(draft.members.map(({ id }) => id));
  const choices = [...applications, ...draft.members.filter(({ id }) => !available.has(id))];
  const inputDevices = inputs.filter(({ id, channels }) => isMixInputId(id) && channels > 0);
  const selectedInput = inputDevices.find(({ id }) => id === draft.input?.id);
  const inputChoices =
    draft.input && !selectedInput ? [...inputDevices, draft.input] : inputDevices;
  const expandedInput = inputChoices.find(({ id }) => id === expandedDevice);
  const selectedChannels = draft.input?.channels ?? [];
  const activeChannels = draft.input?.id === expandedDevice ? selectedChannels : [];
  const channelCount =
    typeof expandedInput?.channels === "number" ? Math.min(256, expandedInput.channels) : 0;
  const channels = [
    ...new Set([...Array.from({ length: channelCount }, (_, index) => index), ...activeChannels]),
  ].sort((a, b) => a - b);
  const toggleDevice = (id) => setExpandedDevice((current) => (current === id ? null : id));
  const stereoOutputs = outputs.filter(isMixOutputDevice);
  const outputAvailable = stereoOutputs.some(({ id }) => id === draft.output?.id);
  const outputChoices =
    draft.output && !outputAvailable ? [...stereoOutputs, draft.output] : stereoOutputs;
  const canSave = canSaveSourceMix(draft);
  const mixNotice =
    draft.output && checked.size > 0
      ? "Deselect applications to save a Mix with an output."
      : draft.output && draft.input
        ? "If the input is monitored through this output, it will be counted twice."
        : null;

  useUiSurface({
    kind: "sourceMixEditor",
    origin: "navigable",
    blocking: true,
    busy: saving,
    dismissible: true,
    supportedActions: ["cancel"],
    target: { intent: draft.id ? "edit" : "create", mixId: draft.id },
    onCancel: cancel,
    choices: [
      {
        id: "group:input",
        label: "Input",
        selected: inputOpen,
        run: () => setInputOpen(!inputOpen),
      },
      {
        id: "group:output",
        label: "Output",
        selected: outputOpen,
        run: () => setOutputOpen(!outputOpen),
      },
      {
        id: "group:applications",
        label: "Applications",
        selected: applicationsOpen,
        run: () => setApplicationsOpen(!applicationsOpen),
      },
      ...(inputOpen
        ? inputChoices.map((device) => ({
            id: `input:${device.id}`,
            label: device.label,
            selected: expandedDevice === device.id,
            run: () => toggleDevice(device.id),
          }))
        : []),
      ...(inputOpen && expandedInput
        ? channels.map((channel) => ({
            id: `input-toggle:${channel}`,
            label: `Channel ${channel + 1}`,
            selected: activeChannels.includes(channel),
            run: () => toggleInputChannel(expandedInput, channel),
          }))
        : []),
      ...(outputOpen
        ? outputChoices.map((device) => ({
            id: `output:${device.id}`,
            label: device.label,
            selected: draft.output?.id === device.id,
            run: () => toggleOutput(device),
          }))
        : []),
      ...(applicationsOpen
        ? choices.map((member) => ({
            id: `toggle:${member.id}`,
            label: applicationSourceName(member),
            selected: checked.has(member.id),
            run: () => toggle({ id: member.id, label: applicationSourceName(member) }),
          }))
        : []),
      {
        id: "save",
        label: "Save",
        disabled: !canSave,
        run: () => save({ throwOnError: true }),
      },
      { id: "cancel", label: "Cancel", run: cancel },
    ],
  });

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="mix editor"
      tabIndex={-1}
      data-settings-editor
      className={`${FLOATING_EDITOR_CLASS} ${position ? "" : "top-16 left-1/2 -translate-x-1/2"}`}
      style={position ? { left: position.x, top: position.y } : undefined}
    >
      <div
        {...drag}
        className="flex cursor-move items-center gap-1 border-b border-border px-3 py-2"
      >
        {renaming ? (
          <input
            autoFocus
            aria-label="mix name"
            value={draft.name}
            placeholder={sourceMixName(draft)}
            disabled={saving}
            onPointerDown={(event) => event.stopPropagation()}
            onChange={(event) => rename(event.target.value)}
            onBlur={() => setRenaming(false)}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") {
                rename(originalName.current);
                event.currentTarget.blur();
              }
            }}
            className="plvs-input h-[var(--ui-control-h)] min-w-0 flex-1 rounded-md border border-input bg-transparent px-2 text-[length:var(--ui-fs-panel-title)] font-semibold"
          />
        ) : (
          <>
            <span className="min-w-0 flex-1 truncate text-[length:var(--ui-fs-panel-title)] font-semibold">
              {sourceMixName(draft)}
            </span>
            <IconAction
              aria-label="rename mix"
              disabled={saving}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => {
                originalName.current = draft.name;
                setRenaming(true);
              }}
            >
              <Pencil className="size-[length:var(--ui-icon-management-action)]" />
            </IconAction>
          </>
        )}
      </div>
      <div
        data-settings-editor-body
        className="min-h-0 min-w-0 overflow-y-auto px-3 py-2 text-[length:var(--ui-fs-control)]"
      >
        <fieldset disabled={saving} className="min-w-0">
          <MixGroup
            label="Input"
            open={inputOpen}
            onToggle={() => setInputOpen(!inputOpen)}
            count={selectedChannels.length}
          >
            {inputChoices.length === 0 && (
              <p className="px-2 text-muted-foreground">No Inputs Available</p>
            )}
            {inputChoices.map((device) => (
              <MixGroup
                key={device.id}
                label={formatAudioDeviceLabel(device.label).full}
                open={expandedDevice === device.id}
                onToggle={() => toggleDevice(device.id)}
                count={draft.input?.id === device.id ? selectedChannels.length : 0}
                unavailable={typeof device.channels !== "number"}
              >
                {expandedDevice === device.id &&
                  channels.map((channel) => (
                    <MixCheckRow
                      key={channel}
                      label={`Channel ${channel + 1}`}
                      checked={activeChannels.includes(channel)}
                      onChange={() => toggleInputChannel(device, channel)}
                      unavailable={channel >= channelCount}
                    />
                  ))}
              </MixGroup>
            ))}
          </MixGroup>
          <MixGroup
            label="Output"
            open={outputOpen}
            onToggle={() => setOutputOpen(!outputOpen)}
            count={Number(Boolean(draft.output))}
          >
            {outputChoices.length === 0 && (
              <p className="px-2 text-muted-foreground">No Stereo Outputs Available</p>
            )}
            {outputChoices.map((device) => (
              <MixCheckRow
                key={device.id}
                label={formatAudioDeviceLabel(device.label).full}
                checked={device.id === draft.output?.id}
                unavailable={!isMixOutputDevice(device)}
                onChange={() => toggleOutput(device)}
              />
            ))}
          </MixGroup>
          <MixGroup
            label="Applications"
            open={applicationsOpen}
            onToggle={() => setApplicationsOpen(!applicationsOpen)}
            count={checked.size}
          >
            {choices.length === 0 && (
              <p className="px-2 text-muted-foreground">No Applications Available</p>
            )}
            {choices.map((member) => {
              const label = applicationSourceName(member);
              return (
                <MixCheckRow
                  key={member.id}
                  label={label}
                  tip={applicationWindowContext(member)}
                  checked={checked.has(member.id)}
                  onChange={() => toggle({ id: member.id, label })}
                  unavailable={!available.has(member.id)}
                />
              );
            })}
          </MixGroup>
        </fieldset>
      </div>
      <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-3 py-2">
        {mixNotice && (
          <span
            role="status"
            className="min-w-0 flex-1 text-[length:var(--ui-fs-caption)] text-muted-foreground"
          >
            {mixNotice}
          </span>
        )}
        <Button variant="ghost" disabled={saving} onClick={cancel}>
          Cancel
        </Button>
        <Button disabled={saving || !canSave} onClick={() => void save()}>
          Save
        </Button>
      </div>
    </div>
  );
}
