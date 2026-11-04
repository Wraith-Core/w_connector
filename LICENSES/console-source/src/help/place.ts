/* Where the help note goes: below the "؟" when there is room (above otherwise), opening toward the
   content (leftwards in Arabic, rightwards in English), always clamped inside the viewport. */

export interface Placement { top: number; left: number; arrowX: number; side: 'below' | 'above' }

import { wsScale } from '../wsScale';

/* design px (1080p); multiplied by the screen scale on every placement, like the CSS (ui-scale.cjs) */
const MARGIN_D = 12;
const GAP_D = 10;
const OVERHANG_D = 22;
const ARROW_D = 14;

export function placeNote(anchor: DOMRect, w: number, h: number, rtl: boolean, vw: number, vh: number): Placement {
  const k = wsScale();
  const MARGIN = MARGIN_D * k, GAP = GAP_D * k, OVERHANG = OVERHANG_D * k, ARROW = ARROW_D * k;
  let side: Placement['side'] = 'below';
  let top = anchor.bottom + GAP;
  if (top + h > vh - MARGIN) {
    if (anchor.top - GAP - h >= MARGIN) { side = 'above'; top = anchor.top - GAP - h; }
    else top = Math.max(MARGIN, vh - MARGIN - h);
  }
  let left = rtl ? anchor.right + OVERHANG - w : anchor.left - OVERHANG;
  left = Math.min(Math.max(left, MARGIN), Math.max(MARGIN, vw - MARGIN - w));
  const cx = anchor.left + anchor.width / 2;
  const arrowX = Math.min(Math.max(cx - left, ARROW), w - ARROW);
  return { top: Math.round(top), left: Math.round(left), arrowX: Math.round(arrowX), side };
}
