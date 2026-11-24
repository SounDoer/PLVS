import { useLayoutEffect, useRef, useState } from "react";
import { Pencil } from "lucide-react";
import { useFloatingPanelDrag } from "../hooks/useFloatingPanelDrag.js";
import {
  canSaveSourceMix,
  isMixInputId,
  sourceMixMemberCount,
  sourceMixName,
} from "../lib/sourceMixes.js";
import { useUiSurface } from "../uiNavigation/UiNavigationContext.jsx";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { IconAction } from "./ui/icon-action";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { FLOATING_EDITOR_CLASS } from "./ui/surfaceStyles.js";

function inputChannelChoices(count) {
  return [
    ...Array.from({ length: Math.max(0, count - 1) }, (_, index) => ({
      channels: [index, index + 1],
      label: `Channels ${index + 1}–${index + 2} · Stereo`,
    })),
    ...Array.from({ length: count }, (_, index) => ({
      channels: [index],
      label: `Channel ${index + 1} · Mono`,
    })),
  ];
}

export function SourceMixEditor({ owner, applications, inputs = [] }) {
  const {
    draft,
    saving,
    rename,
    cancel,
    save,
    toggle,
    toggleInput,
    selectInputChannels,
    sumInputChannels,
    toggleInputChannel,
  } = owner;
  const ref = useRef(null);
  const [position, setPosition] = useState(null);
  const [renaming, setRenaming] = useState(false);
  const originalName = useRef("");
  const drag = useFloatingPanelDrag(ref, setPosition);
  useLayoutEffect(() => ref.current?.focus(), []);
  const available = new Map(applications.map((application) => [application.id, application]));
  const checked = new Set(draft.members.map(({ id }) => id));
  const choices = [
    ...new Map(
      [
        ...(draft.original?.members ?? []),
        ...applications,
        ...draft.members.filter(({ id }) => !available.has(id)),
      ].map((member) => [member.id, member])
    ).values(),
  ];
  const inputDevices = inputs.filter(({ id, channels }) => isMixInputId(id) && channels > 0);
  const selectedInput = inputDevices.find(({ id }) => id === draft.input?.id);
  const inputChoices =
    draft.input && !selectedInput ? [...inputDevices, draft.input] : inputDevices;
  const channelChoices = inputChannelChoices(Math.min(256, selectedInput?.channels ?? 0));
  const isSumming = draft.input?.mode === "sum";
  const channelValue = isSumming ? "sum" : draft.input?.channels.join("-");
  const canSum = (selectedInput?.channels ?? 0) >= 2;
  const summableChannels = isSumming
    ? [
        ...new Set([
          ...Array.from({ length: Math.min(256, selectedInput?.channels ?? 0) }, (_, i) => i),
          ...draft.input.channels,
        ]),
      ].sort((a, b) => a - b)
    : [];
  const selectedChannelsAvailable = channelChoices.some(
    ({ channels }) => channels.join("-") === channelValue
  );
  const canSave = canSaveSourceMix(draft);
  const memberCount = sourceMixMemberCount(draft);
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
      ...choices.map((member) => ({
        id: `toggle:${member.id}`,
        label: member.label,
        selected: checked.has(member.id),
        run: () => toggle(member),
      })),
      ...inputChoices.map((device) => ({
        id: `input:${device.id}`,
        label: device.label,
        selected: device.id === draft.input?.id,
        run: () => toggleInput(device),
      })),
      ...channelChoices.map(({ channels, label }) => ({
        id: `input-channels:${channels.join("-")}`,
        label,
        selected: channels.join("-") === channelValue,
        run: () => selectInputChannels(channels),
      })),
      ...(canSum
        ? [
            {
              id: "input-mode:sum",
              label: "Sum Channels",
              selected: isSumming,
              run: sumInputChannels,
            },
          ]
        : []),
      ...summableChannels.map((channel) => ({
        id: `input-toggle:${channel}`,
        label: `Channel ${channel + 1}`,
        selected: draft.input.channels.includes(channel),
        run: () => toggleInputChannel(channel),
      })),
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
        className="min-h-0 overflow-y-auto px-3 py-2 text-[length:var(--ui-fs-control)]"
      >
        <fieldset disabled={saving}>
          <legend className="pt-2 font-medium text-muted-foreground">Input</legend>
          {inputChoices.length === 0 ? (
            <p className="text-muted-foreground">No Inputs Available</p>
          ) : null}
          {inputChoices.map((device) => (
            <label
              key={device.id}
              className="flex min-h-[var(--ui-control-h)] cursor-pointer items-center gap-2 rounded-md px-1 hover:bg-ui-hover"
            >
              <Checkbox
                checked={device.id === draft.input?.id}
                onChange={() => toggleInput(device)}
              />
              <span className="min-w-0 flex-1 truncate">{device.label}</span>
              {typeof device.channels !== "number" && (
                <span className="text-muted-foreground">Unavailable</span>
              )}
            </label>
          ))}
          {draft.input && selectedInput && (
            <Select
              disabled={saving}
              value={selectedChannelsAvailable || (isSumming && canSum) ? channelValue : ""}
              onValueChange={(value) =>
                value === "sum"
                  ? sumInputChannels()
                  : selectInputChannels(value.split("-").map(Number))
              }
            >
              <SelectTrigger aria-label="input channels">
                <SelectValue placeholder="Selected Channels Unavailable" />
              </SelectTrigger>
              <SelectContent variant="inline">
                {canSum && <SelectItem value="sum">Sum Channels</SelectItem>}
                {channelChoices.map(({ channels, label }) => (
                  <SelectItem key={channels.join("-")} value={channels.join("-")}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {summableChannels.map((channel) => (
            <label
              key={channel}
              className="flex min-h-[var(--ui-control-h)] cursor-pointer items-center gap-2 rounded-md px-1 hover:bg-ui-hover"
            >
              <Checkbox
                checked={draft.input.channels.includes(channel)}
                onChange={() => toggleInputChannel(channel)}
              />
              <span className="min-w-0 flex-1">Channel {channel + 1}</span>
              {channel >= (selectedInput?.channels ?? 0) && (
                <span className="text-muted-foreground">Unavailable</span>
              )}
            </label>
          ))}
        </fieldset>
        <fieldset disabled={saving} className="mt-2">
          <legend className="font-medium text-muted-foreground">Applications</legend>
          {choices.length === 0 ? (
            <p className="text-muted-foreground">No Applications Available</p>
          ) : null}
          {choices.map((member) => (
            <label
              key={member.id}
              className="flex min-h-[var(--ui-control-h)] cursor-pointer items-center gap-2 rounded-md px-1 hover:bg-ui-hover"
            >
              <Checkbox checked={checked.has(member.id)} onChange={() => toggle(member)} />
              <span className="min-w-0 flex-1 truncate">
                {available.get(member.id)?.label ?? member.label}
              </span>
              {available.has(member.id) ? null : (
                <span className="text-muted-foreground">Unavailable</span>
              )}
            </label>
          ))}
        </fieldset>
      </div>
      <div className="flex items-center gap-2 border-t border-border px-3 py-2">
        <span
          className="min-w-0 flex-1 text-[length:var(--ui-fs-caption)] text-muted-foreground"
          aria-live="polite"
        >
          {memberCount} {memberCount === 1 ? "Source" : "Sources"} Selected
        </span>
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
