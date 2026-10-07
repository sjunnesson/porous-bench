import type { DeviceProfile } from '../devices/types';
import type { Framebuffer, Rect } from '../framebuffer';
import { EpaperPanel } from './epaper';
import { LcdPanel } from './lcd';
import { LedPanel } from './led';
import { OledPanel } from './oled';

/**
 * The display side of the bus: the controller's memory plus the physics of the glass.
 * Each technology implements how pixels become light (or reflectance).
 */
export interface Panel {
  readonly profile: DeviceProfile;
  /** 0..1. LCD: backlight PWM. AMOLED: the brightness command. OLED: contrast. E-paper: ignored. */
  brightness: number;
  /** Copy a region of the MCU frame buffer into controller RAM (what travels over the bus). */
  write(fb: Framebuffer, r: Rect): void;
  /** E-paper only: start a refresh and return how long BUSY stays high, in ms. */
  refresh?(mode: 'full' | 'partial', now: number): number;
  /** Fill `out` (RGBA, native width × height) with what the glass shows at sim time `now`. */
  render(now: number, out: Uint8ClampedArray): void;
}

export function createPanel(profile: DeviceProfile): Panel {
  switch (profile.tech) {
    case 'lcd':
      return new LcdPanel(profile);
    case 'amoled':
      return new LcdPanel(profile, 0); // emissive: black is off
    case 'oled':
      return new OledPanel(profile);
    case 'epaper':
      return new EpaperPanel(profile);
    case 'led':
      return new LedPanel(profile);
  }
}

export function parseHex(hex: string | undefined, fallback: [number, number, number]): [number, number, number] {
  if (!hex) return fallback;
  const v = parseInt(hex.replace('#', ''), 16);
  return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
}

/** Controller RAM is undefined at power-on; showing noise until the first write is realistic. */
export function powerOnNoise(n: number, seed: number, mod: number): number[] {
  const out: number[] = new Array(n);
  let s = seed >>> 0;
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    out[i] = (s >>> 8) % mod;
  }
  return out;
}
