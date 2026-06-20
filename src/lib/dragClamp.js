/**
 * @param {{x:number,y:number}} pos
 * @param {{w:number,h:number}} panel
 * @param {{w:number,h:number}} win
 * @returns {{x:number,y:number}}
 */
export function clampPanelPos(pos, panel, win) {
  return {
    x: Math.max(0, Math.min(pos.x, win.w - panel.w)),
    y: Math.max(0, Math.min(pos.y, win.h - panel.h)),
  };
}
