import { rgb565ToRgb } from '../color';
import type { DeviceProfile } from '../devices/types';
import type { Framebuffer, Rect } from '../framebuffer';
import { type Panel, powerOnNoise } from './panel';

// Transmissive LCD: backlight × pixel transmittance. IPS black still leaks a little light.
// AMOLED: every pixel emits its own light, so black is off; brightness scales them all.
const BLACK_LEVEL = 0.02;

export class LcdPanel implements Panel {
  brightness = 1;
  private ram: Uint16Array;

  constructor(
    readonly profile: DeviceProfile,
    private blackLevel = BLACK_LEVEL,
  ) {
    this.ram = Uint16Array.from(powerOnNoise(profile.width * profile.height, 0x7789, 0x10000));
  }

  write(fb: Framebuffer, r: Rect): void {
    const src = fb.data as Uint16Array;
    for (let y = r.y; y < r.y + r.h; y++) {
      const o = y * fb.width;
      this.ram.set(src.subarray(o + r.x, o + r.x + r.w), o + r.x);
    }
  }

  render(_now: number, out: Uint8ClampedArray): void {
    const k = this.brightness * (1 - this.blackLevel);
    const base = this.brightness * this.blackLevel * 255;
    for (let i = 0; i < this.ram.length; i++) {
      const [r, g, b] = rgb565ToRgb(this.ram[i]);
      const o = i * 4;
      out[o] = base + r * k;
      out[o + 1] = base + g * k;
      out[o + 2] = base + b * k;
      out[o + 3] = 255;
    }
  }
}
