import { Menu, Submenu, MenuItem, CheckMenuItem, PredefinedMenuItem } from "@tauri-apps/api/menu";

/** @typedef {{ key: string, kind?: string, text?: string, enabled?: boolean,
 * checked?: boolean, action?: (...args: any[]) => any, items?: TrayMenuDefinition[] }} TrayMenuDefinition */

/**
 * Keep the attached native menu and surviving item handles for the Tray's lifetime. On Windows,
 * replacing the menu detaches the command subclass even while its old popup is tracking a click.
 * Stable handles also keep the original action channel alive while its callback reads fresh state.
 */
export async function createNativeTrayMenu(definitions) {
  const nodes = new Map();
  let queue = Promise.resolve();
  let closed = false;

  async function syncChildren(container, current, definitions, used) {
    const next = [];
    for (const definition of definitions) next.push(await syncNode(definition, used));
    for (let index = current.length - 1; index >= 0; index -= 1) {
      if (!next.includes(current[index])) {
        await container.remove(current[index].handle);
        current.splice(index, 1);
      }
    }
    for (let index = 0; index < next.length; index += 1) {
      const node = next[index];
      if (current[index] === node) continue;
      const previous = current.indexOf(node);
      if (previous >= 0) {
        await container.remove(node.handle);
        current.splice(previous, 1);
      }
      await container.insert(node.handle, index);
      current.splice(index, 0, node);
    }
  }

  async function syncNode(definition, used) {
    used.add(definition.key);
    let node = nodes.get(definition.key);
    if (!node) {
      node = { definition, action: definition.action, children: [], handle: null };
      const options = {
        text: definition.text,
        enabled: definition.enabled ?? true,
        action: () => node.action?.(),
      };
      if (definition.kind === "submenu") {
        for (const child of definition.items) node.children.push(await syncNode(child, used));
        node.handle = await Submenu.new({
          text: definition.text,
          enabled: options.enabled,
          items: node.children.map((child) => child.handle),
        });
      } else if (definition.kind === "separator") {
        node.handle = await PredefinedMenuItem.new({ item: "Separator" });
      } else if (definition.kind === "check") {
        node.handle = await CheckMenuItem.new({ ...options, checked: definition.checked });
      } else {
        node.handle = await MenuItem.new(options);
      }
      nodes.set(definition.key, node);
      return node;
    }
    node.action = definition.action;
    if (definition.kind !== "separator") {
      if (node.definition.text !== definition.text) await node.handle.setText(definition.text);
      if ((node.definition.enabled ?? true) !== (definition.enabled ?? true))
        await node.handle.setEnabled(definition.enabled ?? true);
      if (definition.kind === "check" && node.definition.checked !== definition.checked)
        await node.handle.setChecked(definition.checked);
      if (definition.kind === "submenu")
        await syncChildren(node.handle, node.children, definition.items, used);
    }
    node.definition = definition;
    return node;
  }

  const children = [];
  const initialUsed = new Set();
  for (const definition of definitions) children.push(await syncNode(definition, initialUsed));
  const menu = await Menu.new({ items: children.map((node) => node.handle) });
  return {
    menu,
    update(definitions) {
      const update = queue
        .catch(() => {})
        .then(async () => {
          if (closed) return;
          const used = new Set();
          await syncChildren(menu, children, definitions, used);
          for (const [key, node] of nodes) {
            if (used.has(key)) continue;
            node.action = null;
            await node.handle.close();
            nodes.delete(key);
          }
        });
      queue = update;
      return update;
    },
    async close() {
      closed = true;
      await queue.catch(() => {});
      await menu.close();
      for (const node of nodes.values()) {
        node.action = null;
        await node.handle.close();
      }
      nodes.clear();
    },
  };
}
