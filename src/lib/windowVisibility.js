export async function hideAppWindow({ docked, window, suspendDock }) {
  if (docked) {
    await suspendDock();
    return;
  }
  await window.hide();
  await window.setSkipTaskbar(true);
}

export async function toggleAppWindow({ docked, window, suspendDock, resumeDock }) {
  const visible = await window.isVisible();
  if (visible) {
    await hideAppWindow({ docked, window, suspendDock });
    return;
  }
  if (docked) {
    await resumeDock();
    return;
  }
  await window.show();
  await window.setSkipTaskbar(false);
  await window.setFocus();
}

// Brings the workbench forward even when it is already visible but minimized or behind other
// windows. A visible Dock strip is left alone: it is a fixed edge band, not a window to raise.
export async function showAppWindow({ docked, window, resumeDock }) {
  if (await window.isVisible()) {
    if (docked) return;
    await window.unminimize();
    await window.setFocus();
    return;
  }
  if (docked) {
    await resumeDock();
    return;
  }
  await window.show();
  await window.setSkipTaskbar(false);
  await window.setFocus();
}
