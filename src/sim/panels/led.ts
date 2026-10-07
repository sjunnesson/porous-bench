import { rgb565ToRgb } from '../color';
import type { DeviceProfile } from '../devices/types';
import type { Framebuffer, Rect } from '../framebuffer';
import type { Panel } from './panel';

/**
 * Addressable LEDs (WS2812B): each LED latches the colour it was last sent and holds it. They power
 * up dark. Brightness scales every channel the way FastLED's setBrightness() does (the chip has no
 * dimming of its own). render() gives each LED's emitted colour; the views draw the glow.
 */
export class LedPanel implements Panel {
  brightness = 1;
  private ram: Uint16Array;

  constructor(readonly profile: DeviceProfile) {
    this.ram = new Uint16Array(profile.width * profile.height);
  }

  write(fb: Framebuffer, r: Rect): void {
    const src = fb.data as Uint16Array;
    for (let y = r.y; y < r.y + r.h; y++) {
      const o = y * fb.width;
      this.ram.set(src.subarray(o + r.x, o + r.x + r.w), o + r.x);
    }
  }

  render(_now: number, out: Uint8ClampedArray): void {
    const k = this.brightness;
    for (let i = 0; i < this.ram.length; i++) {
      const [r, g, b] = rgb565ToRgb(this.ram[i]);
      const o = i * 4;
      out[o] = r * k;
      out[o + 1] = g * k;
      out[o + 2] = b * k;
      out[o + 3] = 255;
    }
  }
}
