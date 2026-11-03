// The pointer over a screen in the gallery, in the panel's own terms. A screen is drawn turned by a
// number of quarter turns clockwise (so its app reads upright), and both the touch panel and the IMU
// work in the panel's native orientation: what's on screen is turned back first.

/** A vector on the page (x right, y down) turned back by `turn` quarter turns: in the panel's frame. */
export function unturn(x: number, y: number, turn: number): [number, number] {
  for (let i = 0; i < ((turn % 4) + 4) % 4; i++) [x, y] = [y, -x];
  return [x, y];
}

/**
 * The native pixel under the pointer: `dx`, `dy` in CSS px from the screen's centre, `w` × `h` the
 * screen's size on the page before it's turned, `width` × `height` the panel's pixels. Null off the
 * glass (on round glass, outside the circle).
 */
export function glassPixel(dx: number, dy: number, turn: number, w: number, h: number, width: number, height: number, round = false): [number, number] | null {
  const [x, y] = unturn(dx, dy, turn);
  const u = x / w + 0.5;
  const v = y / h + 0.5;
  if (u < 0 || v < 0 || u >= 1 || v >= 1) return null;
  if (round && Math.hypot(u - 0.5, v - 0.5) > 0.5) return null;
  return [Math.floor(u * width), Math.floor(v * height)];
}

/** How far the device leans at the screen's edge: gravity's share along the panel, in g (about 37°). */
export const TILT_AT_EDGE = 0.6;

/**
 * The tilt the pointer gives the device: the side it's over goes down, so a ball rolls towards it, as
 * Bench's IMU widget has it (x, y in the panel's frame, x right and y down). `sx`, `sy`: the pointer
 * from the screen's centre as a share of its half-width and half-height on the page, -1 to 1.
 */
export function tiltAt(sx: number, sy: number, turn: number): { x: number; y: number } {
  const clamp = (v: number) => Math.max(-1, Math.min(1, v));
  const [x, y] = unturn(clamp(sx), clamp(sy), turn);
  return { x: x * TILT_AT_EDGE, y: y * TILT_AT_EDGE };
}

/**
 * A shake from the pointer: moved back and forth quickly. `move` takes each pointer move and says
 * whether it completes a shake (four quick reversals within 600 ms).
 */
export function shakeDetector(): (x: number, y: number, t: number) => boolean {
  let last: { x: number; y: number; t: number } | null = null;
  let dir = { x: 0, y: 0 };
  let turns: number[] = [];
  return (x, y, t) => {
    if (!last) {
      last = { x, y, t };
      return false;
    }
    const dt = Math.max(1, t - last.t);
    const vx = (x - last.x) / dt;
    const vy = (y - last.y) / dt;
    last = { x, y, t };
    // Quick: over a pixel a millisecond along the axis it moves most on.
    const [v, axis] = Math.abs(vx) >= Math.abs(vy) ? [vx, 'x' as const] : [vy, 'y' as const];
    if (Math.abs(v) < 1) return false;
    const s = Math.sign(v);
    if (dir[axis] && s !== dir[axis]) turns.push(t);
    dir[axis] = s;
    turns = turns.filter((at) => t - at < 600);
    if (turns.length < 4) return false;
    turns = [];
    return true;
  };
}
