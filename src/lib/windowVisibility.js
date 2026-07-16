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
