import type { DeviceProfile } from '../devices/types';
import type { Framebuffer, Rect } from '../framebuffer';
import { type Panel, parseHex, powerOnNoise } from './panel';

// Emissive, 1-bit: a pixel is either lit (in the glass's colour) or truly black.
export class OledPanel implements Panel {
  brightness = 0.8;
  private ram: Uint8Array;
  private light: [number, number, number];
  private dark: [number, number, number];
  private accent: [number, number, number];

  constructor(readonly profile: DeviceProfile) {
    this.ram = Uint8Array.from(powerOnNoise(profile.width * profile.height, 0x1306, 2));
    this.light = parseHex(profile.look.light, [234, 244, 255]);
    this.dark = parseHex(profile.look.dark, [0, 0, 0]);
    this.accent = parseHex(profile.look.accentColor, this.light);
  }

  write(fb: Framebuffer, r: Rect): void {
    for (let y = r.y; y < r.y + r.h; y++) {
      const o = y * fb.width;
      this.ram.set(fb.data.subarray(o + r.x, o + r.x + r.w), o + r.x);
    }
  }

  render(_now: number, out: Uint8ClampedArray): void {
    const { width } = this.profile;
    const accentRows = this.profile.look.accentRows ?? 0;
    // SSD1306 contrast changes drive current; the visible effect is modest.
    const k = 0.35 + 0.65 * this.brightness;
    for (let i = 0; i < this.ram.length; i++) {
      const lit = this.ram[i];
      const c = lit ? (Math.floor(i / width) < accentRows ? this.accent : this.light) : this.dark;
      const o = i * 4;
      out[o] = lit ? c[0] * k : c[0];
      out[o + 1] = lit ? c[1] * k : c[1];
      out[o + 2] = lit ? c[2] * k : c[2];
      out[o + 3] = 255;
    }
  }
}
