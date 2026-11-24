import { useEffect, useRef, useState } from "react";
import { sourceMixesStore } from "../persistence/index.js";
import { readSourceMixes, sourceMixName } from "../lib/sourceMixes.js";
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
    setDraft(mix ? { ...mix, original: mix } : { id: null, name: "", members: [], original: null });
  }

  function toggle(member) {
    setDraft((current) => {
      if (!current || writing.current) return current;
      const members = current.members.some(({ id }) => id === member.id)
        ? current.members.filter(({ id }) => id !== member.id)
        : [...current.members, { id: member.id, label: member.label }];
      return { ...current, members };
    });
  }

  async function save({ throwOnError = false } = {}) {
    if (writing.current || !draft || draft.members.length < 2) return;
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
    save,
    remove,
    rename: (name) => setDraft((current) => current && { ...current, name }),
    cancel: () => {
      if (!writing.current) setDraft(null);
    },
  };
}
