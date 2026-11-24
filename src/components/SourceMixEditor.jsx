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
import {
  MIX_FORMATS,
  compileMixRouting,
  resolveMixFormat,
  mixInputs,
  mixRoutingSources,
} from "../lib/mixRouting.js";
import {
  MixSourceRouting,
  MixRouteSelect,
  mixStereoPairs,
  orphanedMixLanes,
} from "./MixSourceRouting.jsx";
import { cn } from "../lib/utils.js";
import { useUiSurface } from "../uiNavigation/UiNavigationContext.jsx";
import {
  EditorDraftRegistryError,
  useEditorDraftSurface,
} from "../agentControl/EditorDraftContext.jsx";
import { mixDraftDocument } from "../agentControl/mixDraftControl.js";
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

function MixCheckRow({
  label,
  checked,
  onChange,
  unavailable = false,
  tip = undefined,
  route = undefined,
  details = undefined,
}) {
  const { anchorRef, showTip, hideTip, tipNode } = useHoverTip({ tip, align: "start" });
  return (
    <div>
      <div className="flex items-center">
        <label
          ref={anchorRef}
          onMouseEnter={tip ? showTip : undefined}
          onMouseLeave={tip ? hideTip : undefined}
          onFocus={tip ? showTip : undefined}
          onBlur={tip ? hideTip : undefined}
          className="flex min-h-[var(--ui-row-h)] min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-xs px-2 hover:bg-ui-hover focus-within:bg-ui-hover"
        >
          <Checkbox checked={checked} onChange={onChange} />
          <span className="min-w-0 flex-1 truncate">{label}</span>
          {unavailable ? <span className="shrink-0 text-muted-foreground">Unavailable</span> : null}
          {tipNode}
        </label>
        {route}
      </div>
      {details}
    </div>
  );
}

export function SourceMixEditor({
  owner,
  applications,
  inputs = [],
  outputs = [],
  defaultOutputReference = undefined,
}) {
  const {
    draft,
    saving,
    rename,
    cancel,
    save,
    toggle,
    toggleInputChannel,
    toggleOutput,
    setRoute,
    setFormat,
  } = owner;
  const ref = useRef(null);
  const [position, setPosition] = useState(null);
  const [renaming, setRenaming] = useState(false);
  const selectedInputs = mixInputs(draft);
  const [inputOpen, setInputOpen] = useState(selectedInputs.length > 0);
  const [routeId, setRouteId] = useState(null);
  const [outputOpen, setOutputOpen] = useState(Boolean(draft.output));
  const [applicationsOpen, setApplicationsOpen] = useState(draft.members.length > 0);
  const [expandedDevice, setExpandedDevice] = useState(selectedInputs[0]?.id ?? null);
  const originalName = useRef("");
  const drag = useFloatingPanelDrag(ref, setPosition);
  useLayoutEffect(() => ref.current?.focus(), []);

  const available = new Set(applications.map(({ id }) => id));
  const checked = new Set(draft.members.map(({ id }) => id));
  const choices = [...applications, ...draft.members.filter(({ id }) => !available.has(id))];
  const inputDevices = inputs.filter(({ id, channels }) => isMixInputId(id) && channels > 0);
  const inputChoices = [
    ...inputDevices,
    ...selectedInputs.filter(({ id }) => !inputDevices.some((device) => device.id === id)),
  ];
  const expandedInput = inputChoices.find(({ id }) => id === expandedDevice);
  const selectedChannels = selectedInputs.reduce((sum, input) => sum + input.channels.length, 0);
  const activeChannels = selectedInputs.find(({ id }) => id === expandedDevice)?.channels ?? [];
  const channelCount =
    typeof expandedInput?.channels === "number" ? Math.min(256, expandedInput.channels) : 0;
  const channels = [
    ...new Set([...Array.from({ length: channelCount }, (_, index) => index), ...activeChannels]),
  ].sort((a, b) => a - b);
  const toggleDevice = (id) => setExpandedDevice((current) => (current === id ? null : id));
  const supportedOutputs = outputs.filter(isMixOutputDevice);
  const outputAvailable = supportedOutputs.some(({ id }) => id === draft.output?.id);
  const outputChoices =
    draft.output && !outputAvailable ? [...supportedOutputs, draft.output] : supportedOutputs;
  const format = resolveMixFormat(draft, outputs, defaultOutputReference);
  const followFormat =
    format.id === "follow"
      ? format
      : resolveMixFormat({ ...draft, format: "follow" }, outputs, defaultOutputReference);
  const sources = mixRoutingSources(draft, outputs);
  const routingSource = sources.find(({ id }) => id === routeId);
  const compiled = compileMixRouting(draft, outputs, defaultOutputReference);
  const canSave = canSaveSourceMix(draft) && Boolean(compiled);
  const hasChannelSettings = (source) =>
    !isMixInputId(source.id) &&
    (source.lanes.length > 1 || orphanedMixLanes(draft, source).length > 0);
  const toggleChannelSettings = (id) => {
    setRouteId((current) => (current === id ? null : id));
    if (draft.output?.id === id) setOutputOpen(true);
    else setApplicationsOpen(true);
  };
  const routingControls = (id, laneKey = undefined) => {
    const source = sources.find((source) => source.id === id);
    const lane = source?.lanes.find(({ key }) => key === laneKey);
    if (!source || (laneKey !== undefined && !lane)) return {};
    const expandable = laneKey === undefined && hasChannelSettings(source);
    const expanded = expandable && routeId === id;
    return {
      route: (
        <MixRouteSelect
          draft={draft}
          source={source}
          laneKey={laneKey}
          label={`route for ${lane?.label ?? source.label}`}
          format={format}
          setRoute={setRoute}
          expanded={expanded}
          onToggle={expandable ? () => toggleChannelSettings(id) : undefined}
        />
      ),
      details: expanded ? (
        <MixSourceRouting draft={draft} source={source} format={format} setRoute={setRoute} />
      ) : undefined,
    };
  };
  const saveDraft = (throwOnError = false) =>
    save({ throwOnError, referenceRoles: followFormat.fallback ? undefined : followFormat.roles });
  const [draftVersion, setDraftVersion] = useState(() => ({ draft, generation: 0 }));
  if (draftVersion.draft !== draft)
    setDraftVersion({ draft, generation: draftVersion.generation + 1 });
  const document = mixDraftDocument(draft);
  const original = mixDraftDocument(
    draft.original
      ? { ...draft.original, inputs: mixInputs(draft.original) }
      : { id: null, name: "", members: [], inputs: [] }
  );
  const dirty = JSON.stringify(document) !== JSON.stringify(original);
  const stale = Boolean(
    draft.id && owner.list && owner.list.find(({ id }) => id === draft.id) !== draft.original
  );
  const routeChoices =
    routingSource?.lanes.flatMap((lane) => {
      const current = draft.routes?.[routeId]?.[lane.key] ?? "auto";
      return ["auto", ...format.roles, "off"].map((destination) => ({
        id:
          destination === "auto" || destination === "off"
            ? `route:${destination}:${lane.key}`
            : `route:to:${lane.key}:${destination}`,
        label: `${lane.label} → ${destination === "auto" ? "Auto" : destination === "off" ? "Off" : destination}`,
        selected: current === destination,
        run: () => setRoute(routeId, lane.key, destination === "auto" ? undefined : destination),
      }));
    }) ?? [];
  const pairs = routingSource ? mixStereoPairs(routingSource, format) : [];
  const mixNotice =
    draft.output && checked.size > 0
      ? "Deselect applications to save a Mix with an output."
      : !compiled
        ? "Fix the unavailable channel routes to save this Mix."
        : draft.output && selectedInputs.length > 0
          ? "If the input is monitored through this output, it will be counted twice."
          : null;

  const surfaceId = useUiSurface({
    kind: "sourceMixEditor",
    origin: "navigable",
    blocking: true,
    busy: saving,
    dismissible: true,
    dirty,
    stale,
    generationKey: draftVersion.generation,
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
      ...MIX_FORMATS.map(({ id, name }) => ({
        id: `format:${id.replaceAll(".", "-")}`,
        label: id === "follow" ? `${name} · ${followFormat.name}` : name,
        selected: format.id === id,
        run: () => setFormat(id),
      })),
      ...sources.filter(hasChannelSettings).map(({ id, label }) => ({
        id: `routing:${id}`,
        label: `Per-Channel Settings · ${label}`,
        selected: routeId === id,
        run: () => toggleChannelSettings(id),
      })),
      ...routeChoices,
      ...(routingSource
        ? orphanedMixLanes(draft, routingSource).map((key) => ({
            id: `route:auto:${key}`,
            label: `Remove unavailable ${key} override`,
            run: () => setRoute(routeId, key, undefined),
          }))
        : []),
      ...pairs.map(([left, right]) => ({
        id: `route:pair:${left}:${right}`,
        label: `${left} / ${right}`,
        run: () => {
          setRoute(routeId, "L", left);
          setRoute(routeId, "R", right);
        },
      })),
      {
        id: "save",
        label: "Save",
        disabled: !canSave,
        run: () => saveDraft(true),
      },
      { id: "cancel", label: "Cancel", run: cancel },
    ],
  });
  useEditorDraftSurface({
    kind: "mix",
    surfaceId,
    controller: {
      inspectDraft: () => ({
        document,
        draftGeneration: draftVersion.generation,
        dirty,
        stale,
        mix: { resolvedFormat: format.name, roles: format.roles, canSave },
        inventory: { applications, inputs: inputDevices, outputs, defaultOutputReference },
      }),
      commitDraftDocument: (next) => {
        if (saving) throw new EditorDraftRegistryError("transitionInProgress");
        owner.replaceDraft(next);
      },
      saveForControl: async () => {
        if (saving || !canSave) throw new EditorDraftRegistryError("draftActionUnavailable");
        const saved = await saveDraft(true);
        if (!saved) throw new EditorDraftRegistryError("draftActionUnavailable");
        return {
          changed: !draft.original || JSON.stringify(saved) !== JSON.stringify(draft.original),
          savedId: saved.id,
          document: mixDraftDocument({ ...saved, inputs: mixInputs(saved) }),
        };
      },
    },
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
            count={selectedChannels}
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
                count={selectedInputs.find(({ id }) => id === device.id)?.channels.length ?? 0}
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
                      {...routingControls(device.id, String(channel))}
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
                {...routingControls(device.id)}
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
                  {...routingControls(member.id)}
                />
              );
            })}
          </MixGroup>
          <label className="flex items-center gap-2 border-t border-border px-2 py-2">
            <span className="flex-1 font-medium">Mix Format</span>
            <select
              aria-label="mix format"
              value={draft.format ?? "follow"}
              title={format.id === "follow" ? followFormat.referenceLabel : undefined}
              onChange={(event) => setFormat(event.target.value)}
              className="plvs-input h-[var(--ui-control-h)] min-w-0 max-w-[65%] rounded-md border border-input bg-card px-2"
            >
              {MIX_FORMATS.map(({ id, name }) => (
                <option key={id} value={id}>
                  {id === "follow"
                    ? `${name} · ${followFormat.fallback ? "Stereo Fallback" : followFormat.name}`
                    : name}
                </option>
              ))}
            </select>
          </label>
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
        <Button disabled={saving || !canSave} onClick={() => void saveDraft()}>
          Save
        </Button>
      </div>
    </div>
  );
}
