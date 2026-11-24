import { resolveMixLane } from "../lib/mixRouting.js";
import { useDropdownNavigation } from "../uiNavigation/useDropdownNavigation.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "./ui/select.jsx";

export function mixStereoPairs(source, format) {
  if (source.lanes.length !== 2 || source.lanes[0].role !== "L" || source.lanes[1].role !== "R")
    return [];
  return ["", "s", "b", "w", "c", "tf", "tm", "tr"]
    .map((suffix) => [`L${suffix}`, `R${suffix}`])
    .filter((roles) => roles.every((role) => format.roles.includes(role)));
}

export function orphanedMixLanes(draft, source) {
  return Object.keys(draft.routes?.[source.id] ?? {}).filter(
    (key) => !source.lanes.some((lane) => lane.key === key)
  );
}

export function MixRouteSelect({
  draft,
  source,
  laneKey = undefined,
  format,
  label,
  expanded = false,
  onToggle = undefined,
  setRoute,
}) {
  const dropdown = useDropdownNavigation(
    `mix-routing:${source.id}${laneKey === undefined ? "" : `:${laneKey}`}`,
    { blockingEditorId: "sourceMix" }
  );
  const lanes =
    laneKey === undefined ? source.lanes : source.lanes.filter(({ key }) => key === laneKey);
  const orphaned = laneKey === undefined ? orphanedMixLanes(draft, source) : [];
  const values = lanes.map(({ key }) => draft.routes?.[source.id]?.[key]);
  const autoRoutes = lanes.map((lane) => resolveMixLane({}, source.id, lane, format));
  const autoDestinations = [
    ...new Set(autoRoutes.flatMap(({ routing }) => routing?.map(([role]) => role) ?? [])),
  ];
  const autoLabel = autoDestinations.length ? `Auto · ${autoDestinations.join(" / ")}` : "Auto";
  const mono = lanes.length === 1;
  const options = mono ? format.roles.map((role) => [role]) : mixStereoPairs(source, format);
  const pair = options.find((roles) => roles.every((role, index) => role === values[index]));
  const automatic = values.every((value) => value === undefined);
  const off = !automatic && values.every((value) => value === "off");
  const invalid =
    orphaned.length > 0 ||
    lanes.some((lane) => !resolveMixLane(draft, source.id, lane, format).valid);
  const value = invalid
    ? "custom"
    : automatic
      ? "auto"
      : off && mono
        ? "off"
        : pair
          ? pair.join(":")
          : "custom";
  const summary = invalid
    ? "Needs Routing"
    : automatic
      ? autoLabel
      : off
        ? "Off"
        : pair
          ? pair.join(" / ")
          : "Custom";

  function choose(next) {
    if (next === "details") {
      onToggle?.();
      return;
    }
    if (next === "auto") {
      for (const { key } of lanes) setRoute(source.id, key, undefined);
      for (const key of orphaned) setRoute(source.id, key, undefined);
      return;
    }
    const roles = next.split(":");
    for (const [index, { key }] of lanes.entries()) setRoute(source.id, key, roles[index]);
  }

  return (
    <Select value={value} onValueChange={choose} {...dropdown.rootProps}>
      <SelectTrigger
        variant="inline"
        className="max-w-[45%]"
        aria-label={label}
        {...dropdown.triggerProps}
      >
        <SelectValue>{summary}</SelectValue>
      </SelectTrigger>
      <SelectContent variant="inline" align="end">
        <SelectItem value="auto">{autoLabel}</SelectItem>
        {options.map((roles) => (
          <SelectItem key={roles.join(":")} value={roles.join(":")}>
            {roles.join(" / ")}
          </SelectItem>
        ))}
        {mono && <SelectItem value="off">Off</SelectItem>}
        {onToggle && (
          <>
            <SelectSeparator />
            <SelectItem value="details">
              {expanded ? "Hide Channel Settings" : "Per-Channel Settings"}
            </SelectItem>
          </>
        )}
      </SelectContent>
    </Select>
  );
}

export function MixSourceRouting({ draft, source, format, setRoute }) {
  return (
    <div className="pb-1 pl-8" role="group" aria-label="per-channel settings">
      {source.lanes.map(({ key, label }) => (
        <div
          key={key}
          className="flex min-h-[var(--ui-control-h)] items-center justify-between gap-2 pl-2"
        >
          <span className="text-muted-foreground">{label}</span>
          <MixRouteSelect
            draft={draft}
            source={source}
            format={format}
            laneKey={key}
            label={`destination for ${label}`}
            setRoute={setRoute}
          />
        </div>
      ))}
      {orphanedMixLanes(draft, source).map((key) => (
        <div
          key={key}
          className="flex min-h-[var(--ui-control-h)] items-center justify-between gap-2 pl-2"
        >
          <span className="text-muted-foreground">{key} · Unavailable</span>
          <Select value="unavailable" onValueChange={() => setRoute(source.id, key, undefined)}>
            <SelectTrigger variant="inline" aria-label={`destination for unavailable ${key}`}>
              <SelectValue>Needs Routing</SelectValue>
            </SelectTrigger>
            <SelectContent align="end" variant="inline">
              <SelectItem value="auto">Auto</SelectItem>
            </SelectContent>
          </Select>
        </div>
      ))}
    </div>
  );
}
