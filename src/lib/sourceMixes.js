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

export function canSaveSourceMix({ members, input }) {
  const summing = input?.mode === "sum";
  return (
    members.length >= (summing ? 0 : input ? 1 : 2) &&
    members.every(
      (member) => /^app-[0-9a-f]{32}$/.test(member?.id) && typeof member.label === "string"
    ) &&
    new Set(members.map(({ id }) => id)).size === members.length &&
    (input == null ||
      (isMixInputId(input.id) &&
        typeof input.label === "string" &&
        Array.isArray(input.channels) &&
        (summing
          ? input.channels.length >= 2
          : input.mode == null && [1, 2].includes(input.channels.length)) &&
        input.channels.every(
          (channel) => Number.isInteger(channel) && channel >= 0 && channel < 256
        ) &&
        input.channels.every(
          (channel, index) => index === 0 || channel > input.channels[index - 1]
        )))
  );
}

export function sourceMixMembers(mix) {
  return mix.input ? [...mix.members, mix.input] : mix.members;
}

export function sourceMixMemberCount(mix) {
  return (
    mix.members.length +
    (mix.input?.mode === "sum" ? mix.input.channels.length : Number(Boolean(mix.input)))
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
      ...(draft.input
        ? [
            draft.input.mode === "sum"
              ? `${draft.input.label} · ${draft.input.channels.map((channel) => channel + 1).join(" + ")}`
              : draft.input.label,
          ]
        : []),
    ].join(" + ") ||
    "Untitled"
  );
}
