import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { relaunch } from "@tauri-apps/plugin-process";
import { createUpdateController } from "../lib/updateController.js";
import { RELEASES_URL } from "../lib/updateCheck.js";
import { useCoordinatorRole } from "../lib/runtimeRole.js";
import { openExternalUrl } from "../ipc/openExternal.js";
import { isTauri } from "../ipc/env.js";
import {
  abortGlobalOperation,
  commitGlobalOperation,
  prepareGlobalOperation,
} from "../runtime/coordination.js";
import { UPDATE_CHECK_INTERVAL_MS } from "./useUpdateCheck.js";

export function useUpdateController({ preferences, startupEligible }) {
  const coordinator = useCoordinatorRole();
  const [controller] = useState(() =>
    createUpdateController({
      invoke,
      prepare: prepareGlobalOperation,
      commit: commitGlobalOperation,
      abort: abortGlobalOperation,
      openExternal: openExternalUrl,
      relaunch,
    })
  );
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const eligibility = useRef(startupEligible);
  useLayoutEffect(() => {
    eligibility.current = startupEligible;
  }, [startupEligible]);

  useEffect(() => {
    void controller.setPreferences(preferences);
  }, [controller, preferences]);
  useEffect(() => {
    if (!isTauri() || !coordinator) return;
    void controller.initialize({ eligible: () => eligibility.current });
    const unlisten = listen("update-download-progress", (event) =>
      controller.progress(event.payload)
    );
    return () => {
      controller.deactivate();
      void unlisten.then((dispose) => dispose());
    };
  }, [controller, coordinator]);
  useEffect(() => {
    if (!startupEligible && state.details?.origin === "startup") controller.dismissDetails();
  }, [controller, startupEligible, state.details?.origin]);

  useEffect(() => {
    if (!coordinator || !state.enabled || !preferences?.autoCheck) return;
    void controller.check(true);
    const timer = window.setInterval(() => void controller.check(true), UPDATE_CHECK_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [controller, coordinator, state.enabled, preferences?.autoCheck, preferences?.autoDownload]);

  const target = state.ready ?? state.candidate ?? state.details?.target;
  return {
    ...state,
    updateInfo: {
      status: !coordinator
        ? "managed"
        : state.initialized && !state.enabled
          ? "disabled"
          : state.checkStatus,
      hasUpdate: Boolean(target),
      latestVersion: target?.version,
      releaseNotes: target?.manifest?.notes ?? "",
      releaseUrl: RELEASES_URL,
      update: target,
    },
    refreshUpdateCheck: () => controller.check(false),
    openDetails: controller.openDetails,
    openFixture: controller.openFixture,
    dismissDetails: controller.dismissDetails,
    confirmInstall: controller.confirmInstall,
    // Legacy presentation adapters remain while fixture-driven dialogs use the same button API.
    install: () => controller.confirmInstall(),
    restartToApply: () => controller.confirmInstall(),
    resetInstall: () => {},
  };
}
