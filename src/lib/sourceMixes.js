import { MIX_AUTO_VERSION, MIX_FORMATS, mixInputs, validMixRoles } from "./mixRouting.js";

export function isSourceMixId(value) {
  return (
    typeof value === "string" && /^mix-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value)
  );
}

export function readSourceMixes(store) {
  return Array.isArray(store.list)
    ? store.list.filter(
        (mix) =>
          isSourceMixId(mix?.id) &&
          typeof mix.name === "string" &&
          mix.name.trim() &&
          Array.isArray(mix.members) &&
          canSaveSourceMix(mix)
      )
    : [];
}

export function isMixInputId(id) {
  return /^cap-[0-9a-f]{32}$/.test(id);
}

export function isMixOutputDevice(device) {
  return (
    /^lb-[0-9a-f]{32}$/.test(device.id) &&
    (validMixRoles(device.mixOutputRoles) || device.mixStereoOutput === true)
  );
}

export function canSaveSourceMix(mix) {
  const { members, output, format, autoVersion, routes } = mix;
  const inputs = mixInputs(mix);
  return (
    (inputs.length > 0 || output != null || members.length > 0) &&
    (format == null || MIX_FORMATS.some(({ id }) => id === format)) &&
    (autoVersion == null || autoVersion === MIX_AUTO_VERSION) &&
    (routes == null ||
      (typeof routes === "object" &&
        !Array.isArray(routes) &&
        Object.values(routes).every(
          (lanes) =>
            lanes &&
            typeof lanes === "object" &&
            Object.values(lanes).every(
              (lane) =>
                Array.isArray(lane) &&
                lane.every(
                  (edge) =>
                    Array.isArray(edge) &&
                    typeof edge[0] === "string" &&
                    Number.isFinite(edge[1]) &&
                    Math.abs(edge[1]) <= 16
                )
            )
        ))) &&
    (output == null ||
      (/^lb-[0-9a-f]{32}$/.test(output.id) &&
        typeof output.label === "string" &&
        (output.roles == null || validMixRoles(output.roles)) &&
        members.length === 0)) &&
    members.every(
      (member) => /^app-[0-9a-f]{32}$/.test(member?.id) && typeof member.label === "string"
    ) &&
    new Set(members.map(({ id }) => id)).size === members.length &&
    (mix.inputs == null || Array.isArray(mix.inputs)) &&
    inputs.length <= 16 &&
    new Set(inputs.map((input) => input?.id)).size === inputs.length &&
    inputs.every(
      (input) =>
        isMixInputId(input?.id) &&
        typeof input.label === "string" &&
        Array.isArray(input.channels) &&
        input.channels.length > 0 &&
        input.channels.every(
          (channel, index) =>
            Number.isInteger(channel) &&
            channel >= 0 &&
            channel < 256 &&
            (index === 0 || channel > input.channels[index - 1])
        )
    )
  );
}

export function sourceMixMembers(mix) {
  return [...mix.members, ...mixInputs(mix), ...(mix.output ? [mix.output] : [])];
}

export function sourceMixMemberCount(mix) {
  return (
    mix.members.length +
    mixInputs(mix).reduce((count, input) => count + input.channels.length, 0) +
    Number(Boolean(mix.output))
  );
}

export function mixInputAvailable(input, devices) {
  const device = devices.find(({ id }) => id === input.id);
  return Boolean(device && input.channels.every((channel) => channel < device.channels));
}

export function sourceMixName(draft) {
  return (
    draft.name.trim() ||
    [
      ...draft.members.map(({ label }) => label),
      ...mixInputs(draft).map(
        ({ label, channels }) => `${label} · ${channels.map((channel) => channel + 1).join(" + ")}`
      ),
      ...(draft.output ? [draft.output.label] : []),
    ].join(" + ") ||
    "Untitled"
  );
}
