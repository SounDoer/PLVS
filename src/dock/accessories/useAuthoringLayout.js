import { useEffect } from "react";
import { deriveAuthoringLayout } from "../authoringLayout.js";

/** Native geometry belongs to the host; shared editors keep their ordinary intrinsic layout. */
export function useAuthoringLayout(active, interfaceSize, action, view) {
  useEffect(() => {
    if (!active) return undefined;
    let frame = 0;
    let previous = "";
    const report = () => {
      frame = 0;
      const editor = document.querySelector("[data-settings-editor]");
      if (!editor) return;
      const preview = Boolean(document.querySelector('[aria-label="Theme preview"]'));
      const rect = editor.getBoundingClientRect();
      const body = editor.querySelector("[data-settings-editor-body]");
      const layout = deriveAuthoringLayout({
        width: rect.width,
        height: rect.height,
        bodyScrollHeight: body?.scrollHeight,
        bodyClientHeight: body?.clientHeight,
        preview,
        view,
        interfaceSize,
        webviewScale: window.devicePixelRatio || 1,
      });
      const key = JSON.stringify(layout);
      if (key !== previous) {
        previous = key;
        void action("settings-layout", layout);
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(report);
    };
    const mutations = new MutationObserver(schedule);
    mutations.observe(document.body, { subtree: true, childList: true, attributes: true });
    const resizes = typeof ResizeObserver === "function" ? new ResizeObserver(schedule) : null;
    const editor = document.querySelector("[data-settings-editor]");
    if (editor) resizes?.observe(editor);
    window.addEventListener("resize", schedule);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      mutations.disconnect();
      resizes?.disconnect();
      window.removeEventListener("resize", schedule);
    };
  }, [active, interfaceSize, action, view]);
}
