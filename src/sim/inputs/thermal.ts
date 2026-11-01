import type { SimClock } from '../clock';
import { SimInput } from './input';

export interface ThermalOptions {
  label?: string;
}

/** 8×8 pixels, a frame every 100 ms (its fastest), each a quarter of a degree. */
export const SIZE = 8;
export const FRAME_MS = 100;
/** What its pixels read in high-gain mode, °C. */
export const RANGE_C: [number, number] = [0, 80];
/** A pixel this much over the background means someone (a hand, a face) is in view, until it's
 *  less than WARM_C - 1 over (so someone at the edge of seeing doesn't flicker in and out). */
export const WARM_C = 3;
/** How a person looks: skin at the sensor's distance, before it's spread over a pixel. */
const SKIN_C = 33;

/** The same small offset for the same pixel (each pixel's own error) or frame (its noise). */
function noise(n: number, k: number): number {
  const x = Math.sin(n * 12.9898 + k * 78.233) * 43758.5453;
  return (x - Math.floor(x) - 0.5) * 2;
}

/**
 * Thermal camera (Panasonic AMG8833, Grid-EYE): 8×8 infrared pixels over a 60° view, 0–80 °C in
 * steps of 0.25 °C, ten frames a second, each pixel a little off in a way of its own (it's ±2.5 °C
 * absolute) and a little noisy. Pixels come row by row, as the sensor sees the scene. The UI sets the
 * room's temperature and puts a warm figure (a hand, a person) in view: where it is across the
 * pixels, and how near, which is how many pixels it fills. Far off, it fills less than a pixel and
 * reads only a little over the room.
 */
export class Thermal extends SimInput {
  readonly kind = 'thermal';
  private background = 22;
  private figure: { x: number; y: number; r: number } | null = { x: 0.5, y: 0.5, r: 1.2 };
  private frame: { n: number; pixels: number[] } = { n: -1, pixels: [] };
  private spot: { n: number; max: number; warm: boolean; x: number; y: number } = { n: -1, max: 0, warm: false, x: 3.5, y: 3.5 };

  constructor(
    opts: ThermalOptions,
    private clock: SimClock,
  ) {
    super(opts.label ?? 'Thermal camera');
  }

  // ---- UI side ----
  setBackground(c: number): void {
    this.background = Math.min(40, Math.max(0, c));
    this.changed();
  }
  get room(): number {
    return this.background;
  }
  /** Someone in view, centred at (x, y) across the view (0..1 each), filling `r` pixels' radius; null: no one. */
  setFigure(f: { x: number; y: number; r: number } | null): void {
    this.figure = f && { x: Math.min(1, Math.max(0, f.x)), y: Math.min(1, Math.max(0, f.y)), r: Math.min(4, Math.max(0.2, f.r)) };
    this.changed();
  }
  get target(): { x: number; y: number; r: number } | null {
    return this.figure;
  }

  // ---- sketch side ----
  /** The latest frame: 64 temperatures, row by row, °C to a quarter degree. */
  pixels(): number[] {
    const n = Math.floor(this.clock.now() / FRAME_MS);
    if (n !== this.frame.n) this.frame = { n, pixels: this.take(n) };
    return this.frame.pixels;
  }
  /** The board's own thermistor: the room, plus the little the sensor warms itself, to 1/16 °C. */
  thermistor(): number {
    return Math.round((this.background + 1.5) * 16) / 16;
  }
  /**
   * What the driver makes of a frame: the hottest pixel, and where the warm part of the view is (its
   * pixels' centre, 0..7 across and down), when anything is WARM_C over the room. The room is the
   * coolest few pixels, not the median: someone near can fill most of the view.
   */
  hotspot(): { max: number; warm: boolean; x: number; y: number } {
    const px = this.pixels();
    if (this.spot.n === this.frame.n) return { ...this.spot };
    const sorted = [...px].sort((a, b) => a - b);
    const room = sorted[3];
    const max = sorted[sorted.length - 1];
    let w = 0;
    let sx = 0;
    let sy = 0;
    px.forEach((v, i) => {
      const k = v - room - WARM_C / 2;
      if (k <= 0) return;
      w += k;
      sx += k * (i % SIZE);
      sy += k * Math.floor(i / SIZE);
    });
    const warm = max - room >= (this.spot.warm ? WARM_C - 1 : WARM_C) && w > 0;
    this.spot = { n: this.frame.n, max, warm, x: warm ? Math.round((sx / w) * 100) / 100 : 3.5, y: warm ? Math.round((sy / w) * 100) / 100 : 3.5 };
    return { ...this.spot };
  }

  private take(n: number): number[] {
    const out: number[] = [];
    for (let i = 0; i < SIZE * SIZE; i++) {
      const cover = this.cover(i % SIZE, Math.floor(i / SIZE));
      const t = this.background + (SKIN_C - this.background) * cover + noise(i, 1) * 0.4 + noise(n, i) * 0.25;
      out.push(Math.round(Math.min(RANGE_C[1], Math.max(RANGE_C[0], t)) * 4) / 4);
    }
    return out;
  }

  /** How much of pixel (i, j) the figure covers: a pixel sees the average of its view, so a figure
   *  smaller than a pixel reads the same wherever it falls across them. */
  private cover(i: number, j: number): number {
    const f = this.figure;
    if (!f) return 0;
    const cx = f.x * SIZE;
    const cy = f.y * SIZE;
    if (Math.hypot(Math.max(0, Math.abs(i + 0.5 - cx) - 0.5), Math.max(0, Math.abs(j + 0.5 - cy) - 0.5)) >= f.r) return 0;
    const S = 8;
    let n = 0;
    for (let a = 0; a < S; a++) for (let b = 0; b < S; b++) if (Math.hypot(i + (a + 0.5) / S - cx, j + (b + 0.5) / S - cy) < f.r) n++;
    return n / (S * S);
  }
}
