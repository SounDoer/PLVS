import { useEffect, useRef, useState } from "react";
import { sourceMixesStore } from "../persistence/index.js";
import { canSaveSourceMix, readSourceMixes, sourceMixName } from "../lib/sourceMixes.js";
import { MIX_AUTO_VERSION, mixInputs, validMixRoles } from "../lib/mixRouting.js";
import { useBlockingEditor } from "./BlockingEditorsContext.jsx";

export function useSourceMixes({ supported, onSelect, onError }) {
  const read = () => readSourceMixes(sourceMixesStore.read());
  const [list, setList] = useState(read);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const writing = useRef(false);
  useBlockingEditor("sourceMix", draft !== null);

  useEffect(() => {
    if (!supported) return;
    return sourceMixesStore.subscribe(() => setList(readSourceMixes(sourceMixesStore.read())));
  }, [supported]);

  function open(mix = null) {
    if (draft || writing.current) return;
    setDraft(
      mix
        ? { ...mix, inputs: mixInputs(mix), original: mix }
        : { id: null, name: "", members: [], inputs: [], original: null }
    );
  }

  function toggle(member) {
    setDraft((current) => {
      if (!current || writing.current) return current;
      const members = current.members.some(({ id }) => id === member.id)
        ? current.members.filter(({ id }) => id !== member.id)
        : [...current.members, { id: member.id, label: member.label }];
      const routes = { ...current.routes };
      if (!members.some(({ id }) => id === member.id)) delete routes[member.id];
      return { ...current, members, routes };
    });
  }

  function toggleInputChannel(device, channel) {
    setDraft((current) => {
      if (!current || writing.current) return current;
      const inputs = mixInputs(current);
      const previous = inputs.find(({ id }) => id === device.id)?.channels ?? [];
      if (!previous.length && inputs.length >= 16) return current;
      const channels = previous.includes(channel)
        ? previous.filter((value) => value !== channel)
        : [...previous, channel].sort((a, b) => a - b);
      const routes = { ...current.routes, [device.id]: { ...current.routes?.[device.id] } };
      if (!channels.includes(channel)) delete routes[device.id][channel];
      if (!channels.length) delete routes[device.id];
      const nextInputs = previous.length
        ? inputs.flatMap((input) =>
            input.id !== device.id ? [input] : channels.length ? [{ ...input, channels }] : []
          )
        : [...inputs, { id: device.id, label: device.label, channels }];
      return { ...current, inputs: nextInputs, routes };
    });
  }

  function toggleOutput(device) {
    setDraft((current) => {
      if (!current || writing.current) return current;
      const routes = { ...current.routes };
      if (current.output) delete routes[current.output.id];
      return {
        ...current,
        output:
          current.output?.id === device.id
            ? null
            : {
                id: device.id,
                label: device.label,
                roles: device.mixOutputRoles ?? ["L", "R"],
                referenceRoles: device.referenceRoles,
              },
        routes,
      };
    });
  }

  function setRoute(id, lane, routes) {
    setDraft((current) => {
      if (!current || writing.current) return current;
      const source = { ...current.routes?.[id] };
      if (routes === undefined) delete source[lane];
      else source[lane] = routes;
      const next = { ...current.routes };
      if (Object.keys(source).length) next[id] = source;
      else delete next[id];
      return { ...current, routes: next };
    });
  }

  async function save({ throwOnError = false, referenceRoles = undefined } = {}) {
    if (writing.current || !draft || !canSaveSourceMix(draft)) return;
    writing.current = true;
    setSaving(true);
    try {
      const current = read();
      const existing = current.find(({ id }) => id === draft.id);
      if (draft.id && existing !== draft.original) {
        throw new Error(
          "This Mix was changed in another Workbench. Reopen it to edit the latest version."
        );
      }
      const mix = {
        id: draft.id ?? `mix-${crypto.randomUUID()}`,
        name: sourceMixName(draft),
        members: draft.members,
        ...(draft.output && { output: draft.output }),
        ...(mixInputs(draft).length && { inputs: mixInputs(draft) }),
        format: draft.format ?? "follow",
        autoVersion: MIX_AUTO_VERSION,
        ...(draft.routes && { routes: draft.routes }),
        ...(validMixRoles(referenceRoles) && { referenceRoles }),
      };
      await sourceMixesStore.persist({
        list: draft.id
          ? current.map((item) => (item.id === mix.id ? mix : item))
          : [...current, mix],
      });
      setList(read());
      setDraft(null);
      if (!draft.id) await onSelect(mix.id);
    } catch (error) {
      onError("Could Not Save Mix", error);
      if (throwOnError) throw error;
    } finally {
      writing.current = false;
      setSaving(false);
    }
  }

  async function remove(mix) {
    if (draft || writing.current) return;
    writing.current = true;
    try {
      const current = read();
      if (current.find(({ id }) => id === mix.id) !== mix)
        throw new Error("This Mix changed. Reopen Sources to review it.");
      await sourceMixesStore.persist({ list: current.filter(({ id }) => id !== mix.id) });
      setList(read());
    } catch (error) {
      onError("Could Not Delete Mix", error);
    } finally {
      writing.current = false;
    }
  }

  return {
    supported,
    list,
    draft,
    saving,
    open,
    toggle,
    toggleInputChannel,
    toggleOutput,
    setRoute,
    setFormat: (format) =>
      setDraft((current) => (current && !writing.current ? { ...current, format } : current)),
    save,
    remove,
    rename: (name) => setDraft((current) => current && { ...current, name }),
    cancel: () => {
      if (!writing.current) setDraft(null);
    },
  };
}
