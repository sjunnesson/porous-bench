import { type Color, luminance565 } from './color';

export type PixelFormat = 'rgb565' | 'mono';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// 4x4 Bayer matrix, scaled to 0..255 thresholds. Used when dithering colour onto 1-bit panels.
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) * 16);

/**
 * MCU-side frame buffer in the panel's native orientation and pixel format.
 * rgb565: one Color per pixel. mono: 1 = light (lit OLED pixel / white paper), 0 = dark.
 */
export class Framebuffer {
  readonly data: Uint16Array | Uint8Array;
  dither = false;
  private dx0 = 0;
  private dy0 = 0;
  private dx1 = -1;
  private dy1 = -1;

  constructor(
    readonly width: number,
    readonly height: number,
    readonly format: PixelFormat,
  ) {
    this.data = format === 'rgb565' ? new Uint16Array(width * height) : new Uint8Array(width * height);
    this.markAllDirty();
  }

  /** Native pixel write. No bounds checks: callers clip. */
  set(x: number, y: number, c: Color): void {
    const i = y * this.width + x;
    if (this.format === 'rgb565') this.data[i] = c;
    else this.data[i] = this.light(x, y, c);
    this.touch(x, y, x, y);
  }

  get(x: number, y: number): number {
    return this.data[y * this.width + x];
  }

  fill(x0: number, y0: number, x1: number, y1: number, c: Color): void {
    if (this.format === 'rgb565' || !this.dither) {
      const v = this.format === 'rgb565' ? c : this.light(0, 0, c);
      for (let y = y0; y <= y1; y++) this.data.fill(v, y * this.width + x0, y * this.width + x1 + 1);
    } else {
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) this.data[y * this.width + x] = this.light(x, y, c);
    }
    this.touch(x0, y0, x1, y1);
  }

  markAllDirty(): void {
    this.dx0 = 0;
    this.dy0 = 0;
    this.dx1 = this.width - 1;
    this.dy1 = this.height - 1;
  }

  isDirty(): boolean {
    return this.dx1 >= this.dx0;
  }

  /** Returns the native rect changed since the last call, or null. */
  takeDirty(): Rect | null {
    if (!this.isDirty()) return null;
    const r = { x: this.dx0, y: this.dy0, w: this.dx1 - this.dx0 + 1, h: this.dy1 - this.dy0 + 1 };
    this.dx0 = this.dy0 = 0;
    this.dx1 = this.dy1 = -1;
    return r;
  }

  private light(x: number, y: number, c: Color): number {
    const threshold = this.dither ? BAYER[(y & 3) * 4 + (x & 3)] : 128;
    return luminance565(c) >= threshold ? 1 : 0;
  }

  private touch(x0: number, y0: number, x1: number, y1: number) {
    if (!this.isDirty()) {
      this.dx0 = x0;
      this.dy0 = y0;
      this.dx1 = x1;
      this.dy1 = y1;
      return;
    }
    if (x0 < this.dx0) this.dx0 = x0;
    if (y0 < this.dy0) this.dy0 = y0;
    if (x1 > this.dx1) this.dx1 = x1;
    if (y1 > this.dy1) this.dy1 = y1;
  }
}
