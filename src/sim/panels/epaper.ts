import type { DeviceProfile } from '../devices/types';
import type { Framebuffer, Rect } from '../framebuffer';
import { type Panel, parseHex } from './panel';

// Fraction of the previous image left behind by a partial refresh. Accumulates until a full refresh.
const GHOST = 0.08;

interface Refresh {
  t0: number;
  dur: number;
  full: boolean;
}

/**
 * Reflective, bistable: writing RAM changes nothing you can see. Only a refresh moves the
 * particles, and it takes time. A full refresh flashes black/white and clears ghosting;
 * a partial one only drives changed pixels and leaves a faint ghost of what was there.
 */
export class EpaperPanel implements Panel {
  brightness = 1;
  private ram: Uint8Array;
  /** Reflectance 0 (ink) … 1 (paper) of each pixel once the current refresh has settled. */
  private shown: Float32Array;
  private from: Float32Array;
  private final: Float32Array;
  private active: Refresh | null = null;
  private paper: [number, number, number];
  private ink: [number, number, number];

  constructor(readonly profile: DeviceProfile) {
    const n = profile.width * profile.height;
    this.ram = new Uint8Array(n).fill(1);
    this.shown = new Float32Array(n).fill(1);
    this.from = new Float32Array(n);
    this.final = new Float32Array(n);
    this.paper = parseHex(profile.look.light, [228, 226, 218]);
    this.ink = parseHex(profile.look.dark, [28, 28, 31]);
  }

  write(fb: Framebuffer, r: Rect): void {
    for (let y = r.y; y < r.y + r.h; y++) {
      const o = y * fb.width;
      this.ram.set(fb.data.subarray(o + r.x, o + r.x + r.w), o + r.x);
    }
  }

  refresh(mode: 'full' | 'partial', now: number): number {
    this.settle(Infinity);
    const full = mode === 'full';
    this.from.set(this.shown);
    for (let i = 0; i < this.ram.length; i++) {
      const target = this.ram[i];
      if (full) this.final[i] = target;
      else if (Math.round(this.shown[i]) === target) this.final[i] = this.shown[i]; // not driven
      else this.final[i] = target + (this.shown[i] - target) * GHOST;
    }
    const timing = this.profile.epaper ?? { fullRefreshMs: 2000, partialRefreshMs: 300 };
    const dur = full ? timing.fullRefreshMs : timing.partialRefreshMs;
    this.active = { t0: now, dur, full };
    return dur;
  }

  render(now: number, out: Uint8ClampedArray): void {
    this.settle(now);
    const a = this.active;
    const t = a ? Math.min(1, Math.max(0, (now - a.t0) / a.dur)) : 1;
    const [pr, pg, pb] = this.paper;
    const [ir, ig, ib] = this.ink;
    for (let i = 0; i < this.shown.length; i++) {
      const v = a ? this.during(i, t, a.full) : this.shown[i];
      const o = i * 4;
      out[o] = ir + (pr - ir) * v;
      out[o + 1] = ig + (pg - ig) * v;
      out[o + 2] = ib + (pb - ib) * v;
      out[o + 3] = 255;
    }
  }

  private settle(now: number) {
    if (this.active && now >= this.active.t0 + this.active.dur) {
      this.shown.set(this.final);
      this.active = null;
    }
  }

  // Reflectance of pixel i at refresh progress t (0..1).
  private during(i: number, t: number, full: boolean): number {
    const from = this.from[i];
    const to = this.final[i];
    if (!full) return from === to ? from : from + (to - from) * smooth(t);
    // Full update waveform, simplified: inverse → black → white → black → image.
    const stages = [1 - from, 0, 1, 0, to];
    const k = Math.min(stages.length - 1, Math.floor(t * stages.length));
    const u = Math.min(1, (t * stages.length - k) * 3);
    const prev = k === 0 ? from : stages[k - 1];
    return prev + (stages[k] - prev) * smooth(u);
  }
}

const smooth = (t: number) => t * t * (3 - 2 * t);
