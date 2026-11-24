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
          mix.members.length >= 2 &&
          mix.members.every(
            (member) => /^app-[0-9a-f]{32}$/.test(member?.id) && typeof member.label === "string"
          ) &&
          new Set(mix.members.map(({ id }) => id)).size === mix.members.length
      )
    : [];
}

export function sourceMixName(draft) {
  return draft.name.trim() || draft.members.map(({ label }) => label).join(" + ") || "Untitled";
}
