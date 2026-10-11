import { appHandlers } from "./app.js";
/**
 * Every wire method a running app serves, mapped to its handler.
 *
 * @type {Readonly<Record<string, import("../bridge/types.js").HandlerEntry>>}
 */
export const METHOD_TABLE = Object.freeze({
  ...appHandlers,
});
