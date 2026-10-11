import { workspaceLayoutHandlers } from "./workspaceLayout.js";
import { panelHandlers } from "./panel.js";
import { axisHandlers } from "./axis.js";
import { viewHandlers } from "./view.js";
import { settingsHandlers } from "./settings.js";
import { moduleHandlers } from "./module.js";
import { appHandlers } from "./app.js";
/**
 * Every wire method a running app serves, mapped to its handler.
 *
 * @type {Readonly<Record<string, import("../bridge/types.js").HandlerEntry>>}
 */
export const METHOD_TABLE = Object.freeze({
  ...appHandlers,
  ...moduleHandlers,
  ...settingsHandlers,
  ...viewHandlers,
  ...axisHandlers,
  ...panelHandlers,
  ...workspaceLayoutHandlers,
});
