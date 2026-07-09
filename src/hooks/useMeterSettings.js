import { useEffect, useState } from "react";
import { settingsStore } from "../persistence/index.js";
import { sanitizeChannelLabelOverrides } from "../math/channelRoles.js";
import { normalizeReferenceLufs } from "../settings/defaults.js";

export function useMeterSettings() {
  const [referenceLufs, setReferenceLufsState] = useState(() =>
    normalizeReferenceLufs(settingsStore.read().referenceLufs)
  );
  const [channelLabelOverrides, setChannelLabelOverridesState] = useState(() =>
    sanitizeChannelLabelOverrides(settingsStore.read().channelLabelOverrides)
  );

  function setReferenceLufs(nextReferenceLufs) {
    setReferenceLufsState(normalizeReferenceLufs(nextReferenceLufs));
  }

  function setChannelLabelOverrides(nextOverrides) {
    setChannelLabelOverridesState((prev) =>
      sanitizeChannelLabelOverrides(
        typeof nextOverrides === "function" ? nextOverrides(prev) : nextOverrides
      )
    );
  }

  useEffect(() => {
    settingsStore.patch({
      referenceLufs,
      channelLabelOverrides,
    });
  }, [referenceLufs, channelLabelOverrides]);

  useEffect(
    () =>
      settingsStore.subscribe(() => {
        const settings = settingsStore.read();
        setReferenceLufsState(normalizeReferenceLufs(settings.referenceLufs));
        setChannelLabelOverridesState(
          sanitizeChannelLabelOverrides(settings.channelLabelOverrides)
        );
      }),
    []
  );

  return {
    referenceLufs,
    setReferenceLufs,
    channelLabelOverrides,
    setChannelLabelOverrides,
  };
}
