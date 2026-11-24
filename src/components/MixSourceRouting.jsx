import { useEffect, useState } from "react";
import { Button } from "./ui/button";
import { linearMixGain, mixGainDb, resolveMixLane } from "../lib/mixRouting.js";

export function mixLaneSummary(draft, sourceId, lane, format) {
  const { routing, valid } = resolveMixLane(draft, sourceId, lane, format);
  if (!valid) return "Needs Routing";
  return routing.length ? routing.map(([role]) => role).join(" / ") : "Omitted";
}

export function addMixDestination(lane, target) {
  return lane.some(([role]) => role === target) ? lane : [...lane, [target, 1]];
}

export function mixStereoPairs(source, format) {
  if (source.lanes.length !== 2 || source.lanes[0].role !== "L" || source.lanes[1].role !== "R")
    return [];
  return ["", "s", "b", "w", "c", "tf", "tm", "tr"]
    .map((suffix) => [`L${suffix}`, `R${suffix}`])
    .filter((roles) => roles.every((role) => format.roles.includes(role)));
}

function RouteGain({ gain, label, target, onSet }) {
  const [value, setValue] = useState(String(mixGainDb(gain)));
  useEffect(() => {
    setValue(String(mixGainDb(gain)));
  }, [gain]);
  function commit() {
    const parsed = Number(value);
    if (value.trim() && Number.isFinite(parsed)) {
      const db = Math.min(24, Math.max(-60, parsed));
      onSet(linearMixGain(db));
      setValue(String(db));
    } else {
      setValue(String(mixGainDb(gain)));
    }
  }
  return (
    <label className="flex items-center gap-1 text-muted-foreground">
      <input
        aria-label={`gain for ${label} to ${target}`}
        type="number"
        min={-60}
        max={24}
        step="any"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
        className="plvs-input h-[var(--ui-control-h)] w-20 rounded-md border border-input bg-transparent px-2 text-foreground"
      />
      dB
    </label>
  );
}

export function MixSourceRouting({ draft, source, format, setRoute }) {
  const orphaned = Object.keys(draft.routes?.[source.id] ?? {}).filter(
    (key) => !source.lanes.some((lane) => lane.key === key)
  );
  const pairs = mixStereoPairs(source, format);
  return (
    <div className="space-y-2 px-2 py-1">
      {pairs.length > 0 && (
        <label className="flex items-center gap-2">
          Stereo Pair
          <select
            value=""
            onChange={(event) => {
              const roles = event.target.value.split("/");
              source.lanes.forEach(({ key }, index) =>
                setRoute(source.id, key, [[roles[index], 1]])
              );
            }}
            className="plvs-input h-[var(--ui-control-h)] rounded-md border border-input bg-card px-2"
          >
            <option value="" disabled>
              Choose Pair
            </option>
            {pairs.map(([left, right]) => (
              <option key={left} value={`${left}/${right}`}>
                {left} / {right}
              </option>
            ))}
          </select>
        </label>
      )}
      {source.lanes.map((lane) => {
        const { routing, valid, automatic } = resolveMixLane(draft, source.id, lane, format);
        const custom = automatic ? [] : routing;
        const targets = format.roles.filter((role) => !custom.some(([target]) => target === role));
        const set = (routes) => setRoute(source.id, lane.key, routes);
        return (
          <div key={lane.key} className="space-y-1 rounded-md border border-border p-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{lane.label}</span>
              <span className="flex-1 text-muted-foreground">
                {automatic
                  ? `Auto · ${mixLaneSummary(draft, source.id, lane, format)}`
                  : !valid
                    ? "Destination Unavailable"
                    : !custom.length
                      ? "Omitted"
                      : "Custom"}
              </span>
              {!automatic && (
                <Button variant="ghost" onClick={() => set(undefined)}>
                  Reset to Auto
                </Button>
              )}
              <Button variant="ghost" onClick={() => set([])}>
                Omit
              </Button>
            </div>
            {custom.map(([role, gain], index) => (
              <div key={role} className="flex flex-wrap items-center gap-2">
                <select
                  aria-label={`destination for ${lane.label}`}
                  value={role}
                  onChange={(event) =>
                    set(
                      custom.map((route, i) => (i === index ? [event.target.value, gain] : route))
                    )
                  }
                  className="plvs-input h-[var(--ui-control-h)] rounded-md border border-input bg-card px-2"
                >
                  <option value={role}>
                    {role}
                    {format.roles.includes(role) ? "" : " · Unavailable"}
                  </option>
                  {targets.map((target) => (
                    <option key={target} value={target}>
                      {target}
                    </option>
                  ))}
                </select>
                <RouteGain
                  gain={gain}
                  label={lane.label}
                  target={role}
                  onSet={(value) =>
                    set(custom.map((route, i) => (i === index ? [role, value] : route)))
                  }
                />
                <Button variant="ghost" onClick={() => set(custom.filter((_, i) => i !== index))}>
                  Remove
                </Button>
              </div>
            ))}
            {!!targets.length && (
              <select
                aria-label={`add destination for ${lane.label}`}
                value=""
                onChange={(event) => set(addMixDestination(custom, event.target.value))}
                className="plvs-input h-[var(--ui-control-h)] rounded-md border border-input bg-card px-2"
              >
                <option value="" disabled>
                  {automatic ? "Choose Destination" : "Add Destination"}
                </option>
                {targets.map((target) => (
                  <option key={target} value={target}>
                    {target}
                  </option>
                ))}
              </select>
            )}
          </div>
        );
      })}
      {orphaned.map((key) => (
        <div key={key} className="flex items-center gap-2 text-muted-foreground">
          <span className="flex-1">{key} · Source Channel Unavailable</span>
          <Button variant="ghost" onClick={() => setRoute(source.id, key, undefined)}>
            Remove Override
          </Button>
        </div>
      ))}
    </div>
  );
}
