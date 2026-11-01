import { useEffect } from "react";
import { listUiTargets, locateUiTarget } from "../../uiNavigation/uiTargets.js";

/** Every named pointer target in this accessory window, in its own CSS pixels. */
export function readAccessoryTargets(root = globalThis.document) {
  return listUiTargets(root).map(({ id }) => ({ id, rect: locateUiTarget(id, root).rect }));
}

/**
 * Reports this accessory window's named targets to the main window whenever they change, so Agent
 * Control can move the pointer onto a Dock toolbar button or editor row: those live in their own
 * WebView, which the main window cannot measure.
 *
 * @param {(type: string, payload?: any) => unknown} action
 */
export function useAccessoryTargetReport(action) {
  useEffect(() => {
    let last = "";
    let frame = 0;
    const report = () => {
      frame = 0;
      const targets = readAccessoryTargets();
      const key = JSON.stringify(targets);
      if (key === last) return;
      last = key;
      void action("ui-targets", { targets });
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(report);
    };
    const mutations = new MutationObserver(schedule);
    mutations.observe(document.body, { subtree: true, childList: true, attributes: true });
    const resizes = typeof ResizeObserver === "function" ? new ResizeObserver(schedule) : null;
    resizes?.observe(document.body);
    window.addEventListener("resize", schedule);
    schedule();
    return () => {
      if (frame) cancelAnimationFrame(frame);
      mutations.disconnect();
      resizes?.disconnect();
      window.removeEventListener("resize", schedule);
    };
  }, [action]);
}
