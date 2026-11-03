// The physical part around a display's glass, for the views that draw it (the 3D desk, the gallery).

import type { DeviceProfile, Enclosure } from './devices/types';

/** The profile's enclosure, or for one that doesn't describe it a plain one: the glass plus a thin frame. */
export function enclosureOf(p: DeviceProfile): Enclosure {
  if (p.enclosure) return p.enclosure;
  const w = p.look.activeWidthMm || p.width / 6;
  const h = p.look.activeHeightMm || p.height / 6;
  return { style: 'pcb', body: { w: w + 6, h: h + 6, d: 1.6, r: 1.5 }, module: { w: w + 3, h: h + 3, d: 1.6, r: 1, x: 0, y: 0 }, screen: { x: 0, y: 0 } };
}

/** The glass's size in mm: the active area, or a guess from the pixels where it isn't known. */
export function glassMm(p: DeviceProfile): { w: number; h: number; radius: number } {
  const w = p.look.activeWidthMm || p.width / 6;
  const h = p.look.activeHeightMm || p.height / 6;
  return { w, h, radius: ((p.look.cornerRadiusPx ?? 0) * w) / p.width };
}

/** A square whose corner radius reaches its middle is a circle (round glass, a round board). */
export function isCircle(w: number, h: number, r: number): boolean {
  return Math.abs(w - h) < 0.01 && r >= w / 2 - 0.01;
}
