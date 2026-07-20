import { useEffect, useState } from "react";
import { settingsStore } from "../persistence/index.js";
import { sanitizeChannelLabelOverrides } from "../math/channelRoles.js";

/// Note this no longer owns a loudness reference. That value belongs to the active Loudness
/// Profile; the `referenceLufs` key it used to mirror here survives on disk and is still
/// normalized by `profileShape` so old configuration files round-trip.
export function useMeterSettings() {
  const [channelLabelOverrides, setChannelLabelOverridesState] = useState(() =>
    sanitizeChannelLabelOverrides(settingsStore.read().channelLabelOverrides)
  );

  function setChannelLabelOverrides(nextOverrides) {
    setChannelLabelOverridesState((prev) =>
      sanitizeChannelLabelOverrides(
        typeof nextOverrides === "function" ? nextOverrides(prev) : nextOverrides
      )
    );
  }

  useEffect(() => {
    settingsStore.patch({ channelLabelOverrides });
  }, [channelLabelOverrides]);

  useEffect(
    () =>
      settingsStore.subscribe(() => {
        const settings = settingsStore.read();
        setChannelLabelOverridesState(
          sanitizeChannelLabelOverrides(settings.channelLabelOverrides)
        );
      }),
    []
  );

  return {
    channelLabelOverrides,
    setChannelLabelOverrides,
  };
}
