import { CHANNEL_LAYOUTS, roleWeight } from "../math/channelLayoutTable.js";

const G = Math.SQRT1_2;
export const MIX_FORMATS = [{ id: "follow", name: "Follow Output" }, ...CHANNEL_LAYOUTS];
export const MIX_AUTO_VERSION = 1;

export function mixGainDb(gain) {
  return Number((20 * Math.log10(gain)).toFixed(10));
}

export function linearMixGain(db) {
  return 10 ** (Math.min(24, Math.max(-60, db)) / 20);
}

export function validMixRoles(roles) {
  return (
    Array.isArray(roles) &&
    roles.length > 0 &&
    roles.length <= 16 &&
    new Set(roles).size === roles.length &&
    roles.every((role) => role !== "generic" && roleWeight(role) !== null)
  );
}

export function mixInputs(mix) {
  return Array.isArray(mix.inputs) ? mix.inputs : mix.input ? [mix.input] : [];
}

export function resolveMixFormat(mix, outputs, defaultReference) {
  const fixed = CHANNEL_LAYOUTS.find(({ id }) => id === mix.format);
  if (fixed) return { ...fixed, fallback: false };
  const output = mix.output && outputs.find(({ id }) => id === mix.output.id);
  const reference = mix.output ? (output ?? mix.output) : defaultReference;
  const roles = validMixRoles(reference?.referenceRoles)
    ? reference.referenceRoles
    : validMixRoles(mix.referenceRoles)
      ? mix.referenceRoles
      : null;
  const entry =
    roles &&
    CHANNEL_LAYOUTS.find(
      ({ roles: candidate }) =>
        candidate.length === roles.length && candidate.every((role) => roles.includes(role))
    );
  return {
    id: "follow",
    name: entry?.name ?? (roles ? "Custom" : "Stereo"),
    roles: entry?.roles ?? roles ?? ["L", "R"],
    referenceLabel: reference?.label,
    fallback: !roles,
  };
}

export function autoMixRoute(role, roles, named = true) {
  const has = (id) => roles.includes(id);
  if (has(role)) return [[role, 1]];
  if (!named || !role || role === "generic") return null;
  if (role === "LFE") return [];
  if (has("M")) {
    const stereo = autoMixRoute(role, ["L", "R"]);
    return stereo && [["M", stereo.reduce((sum, [, gain]) => sum + gain * G, 0)]];
  }
  if (role === "M" || role === "C")
    return has("C")
      ? [["C", 1]]
      : [
          ["L", G],
          ["R", G],
        ];
  if (role === "Cs") {
    const suffix = has("Lb") ? "b" : has("Ls") ? "s" : "";
    const gain = suffix ? G : 0.5;
    return [
      [`L${suffix}`, gain],
      [`R${suffix}`, gain],
    ];
  }
  if (["Ctf", "Ctm", "Ctr"].includes(role)) {
    return ["L", "R"].flatMap((side) =>
      autoMixRoute(side + role.slice(1), roles).map(([target, gain]) => [target, gain * G])
    );
  }
  const side = role[0];
  const surround = `${side}s`;
  const rear = `${side}b`;
  const topFront = `${side}tf`;
  const topRear = `${side}tr`;
  switch (role.slice(1)) {
    case "s":
    case "tf":
      return [[side, G]];
    case "b":
      return has(surround) ? [[surround, 1]] : [[side, G]];
    case "c":
      return has("C")
        ? [
            [side, G],
            ["C", G],
          ]
        : [[side, 1]];
    case "w":
      return has(surround)
        ? [
            [side, G],
            [surround, G],
          ]
        : [[side, 1]];
    case "tm":
      if (has(topFront) && has(topRear))
        return [
          [topFront, G],
          [topRear, G],
        ];
      if (has(topFront)) return [[topFront, G]];
      if (has(surround)) return [[surround, G]];
      if (has(rear)) return [[rear, G]];
      return [[side, 0.5]];
    case "tr":
      if (has(topFront)) return [[topFront, G]];
      if (has(rear)) return [[rear, G]];
      if (has(surround)) return [[surround, G]];
      return [[side, 0.5]];
    default:
      return null;
  }
}

export function mixRoutingSources(mix, outputs) {
  const sources = [
    ...mixInputs(mix).map(({ id, label, channels }) => ({
      id,
      label,
      lanes: channels.map((channel) => ({
        key: String(channel),
        label: `Channel ${channel + 1}`,
        role: "M",
      })),
    })),
    ...mix.members.map(({ id, label }) => ({
      id,
      label,
      lanes: ["L", "R"].map((role) => ({ key: role, label: role, role })),
    })),
  ];
  if (mix.output) {
    const live = outputs.find(({ id }) => id === mix.output.id);
    const roles = live?.mixOutputRoles ?? mix.output.roles ?? ["L", "R"];
    sources.push({
      ...mix.output,
      outputRoles: roles,
      lanes: roles.map((role) => ({ key: role, label: role, role })),
    });
  }
  return sources;
}

export function resolveMixLane(mix, sourceId, lane, format) {
  const custom = mix.routes?.[sourceId]?.[lane.key];
  const routing = custom ?? autoMixRoute(lane.role, format.roles, format.name !== "Custom");
  const valid =
    routing !== null &&
    routing.every(
      ([target, gain]) =>
        format.roles.includes(target) && Number.isFinite(gain) && Math.abs(gain) <= 16
    );
  return { routing, valid, automatic: custom === undefined };
}

export function compileMixRouting(mix, outputs, defaultReference) {
  const format = resolveMixFormat(mix, outputs, defaultReference);
  const sources = mixRoutingSources(mix, outputs);
  const routes = {};
  let outputRoles;
  for (const source of sources) {
    if (source.outputRoles) outputRoles = source.outputRoles;
    const lanes = source.lanes.map((lane) => resolveMixLane(mix, source.id, lane, format));
    // Preserve role-keyed overrides for an output whose native roles changed, and require repair.
    if (
      source.outputRoles &&
      Object.keys(mix.routes?.[source.id] ?? {}).some(
        (key) => !source.lanes.some((lane) => lane.key === key)
      )
    )
      return null;
    if (lanes.some(({ valid }) => !valid)) return null;
    routes[source.id] = lanes.map(({ routing }) =>
      routing.map(([role, gain]) => [format.roles.indexOf(role), gain])
    );
  }
  return { roles: format.roles, routes, outputRoles };
}
