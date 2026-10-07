// Drawing API modelled on Adafruit_GFX (with a few TFT_eSPI extras like drawString), so a sketch
// written here reads almost line-for-line like its C++ port.

import { type Color, colors } from './color';
import { browserFont, type Font, font5x7, type Glyph } from './fonts/font';
import type { Framebuffer } from './framebuffer';
import type { Sprite } from './sprite';

export type TextAlign = 'left' | 'center' | 'right';

export class Gfx {
  private rot = 0;
  private w: number;
  private h: number;
  private cx = 0;
  private cy = 0;
  private fg: Color = colors.WHITE;
  private bg: Color | null = null;
  private size = 1;
  private wrap = true;
  private font: Font = font5x7;
  private fontCache = new Map<string, Font>();

  constructor(protected fb: Framebuffer) {
    this.w = fb.width;
    this.h = fb.height;
  }

  // ---- geometry ----------------------------------------------------------------------------

  width(): number {
    return this.w;
  }
  height(): number {
    return this.h;
  }
  getRotation(): number {
    return this.rot;
  }
  /** 0..3, quarter turns clockwise. Done in software, so it works the same on every controller. */
  setRotation(r: number): void {
    this.rot = ((r % 4) + 4) % 4;
    this.w = this.rot & 1 ? this.fb.height : this.fb.width;
    this.h = this.rot & 1 ? this.fb.width : this.fb.height;
  }
  /** Ordered dithering when drawing colours onto a 1-bit panel. */
  setDither(on: boolean): void {
    this.fb.dither = on;
  }

  // ---- pixels & shapes ---------------------------------------------------------------------

  fillScreen(c: Color): void {
    this.fb.fill(0, 0, this.fb.width - 1, this.fb.height - 1, c);
  }

  drawPixel(x: number, y: number, c: Color): void {
    x = Math.floor(x);
    y = Math.floor(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const [nx, ny] = this.toNative(x, y);
    this.fb.set(nx, ny, c);
  }

  /** RGB565 for colour panels; WHITE/BLACK for 1-bit panels. */
  getPixel(x: number, y: number): Color {
    x = Math.floor(x);
    y = Math.floor(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
    const [nx, ny] = this.toNative(x, y);
    const v = this.fb.get(nx, ny);
    return this.fb.format === 'rgb565' ? v : v ? colors.WHITE : colors.BLACK;
  }

  fillRect(x: number, y: number, w: number, h: number, c: Color): void {
    x = Math.floor(x);
    y = Math.floor(y);
    w = Math.floor(w);
    h = Math.floor(h);
    if (w < 0) {
      x += w;
      w = -w;
    }
    if (h < 0) {
      y += h;
      h = -h;
    }
    let x0 = Math.max(0, x);
    let y0 = Math.max(0, y);
    let x1 = Math.min(this.w - 1, x + w - 1);
    let y1 = Math.min(this.h - 1, y + h - 1);
    if (x1 < x0 || y1 < y0) return;
    const [ax, ay] = this.toNative(x0, y0);
    const [bx, by] = this.toNative(x1, y1);
    x0 = Math.min(ax, bx);
    x1 = Math.max(ax, bx);
    y0 = Math.min(ay, by);
    y1 = Math.max(ay, by);
    this.fb.fill(x0, y0, x1, y1, c);
  }

  drawFastHLine(x: number, y: number, w: number, c: Color): void {
    this.fillRect(x, y, w, 1, c);
  }
  drawFastVLine(x: number, y: number, h: number, c: Color): void {
    this.fillRect(x, y, 1, h, c);
  }

  drawRect(x: number, y: number, w: number, h: number, c: Color): void {
    this.drawFastHLine(x, y, w, c);
    this.drawFastHLine(x, y + h - 1, w, c);
    this.drawFastVLine(x, y, h, c);
    this.drawFastVLine(x + w - 1, y, h, c);
  }

  drawLine(x0: number, y0: number, x1: number, y1: number, c: Color): void {
    x0 = Math.round(x0);
    y0 = Math.round(y0);
    x1 = Math.round(x1);
    y1 = Math.round(y1);
    if (x0 === x1) return this.fillRect(x0, Math.min(y0, y1), 1, Math.abs(y1 - y0) + 1, c);
    if (y0 === y1) return this.fillRect(Math.min(x0, x1), y0, Math.abs(x1 - x0) + 1, 1, c);
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.drawPixel(x0, y0, c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
  }

  drawCircle(x0: number, y0: number, r: number, c: Color): void {
    x0 = Math.round(x0);
    y0 = Math.round(y0);
    r = Math.round(r);
    this.drawPixel(x0, y0 + r, c);
    this.drawPixel(x0, y0 - r, c);
    this.drawPixel(x0 + r, y0, c);
    this.drawPixel(x0 - r, y0, c);
    this.circleHelper(x0, y0, r, 0xf, c);
  }

  fillCircle(x0: number, y0: number, r: number, c: Color): void {
    x0 = Math.round(x0);
    y0 = Math.round(y0);
    r = Math.round(r);
    for (let dy = -r; dy <= r; dy++) {
      const dx = Math.round(Math.sqrt(r * r - dy * dy));
      this.fillRect(x0 - dx, y0 + dy, 2 * dx + 1, 1, c);
    }
  }

  drawRoundRect(x: number, y: number, w: number, h: number, r: number, c: Color): void {
    r = Math.min(Math.round(r), Math.floor(Math.min(w, h) / 2));
    this.drawFastHLine(x + r, y, w - 2 * r, c);
    this.drawFastHLine(x + r, y + h - 1, w - 2 * r, c);
    this.drawFastVLine(x, y + r, h - 2 * r, c);
    this.drawFastVLine(x + w - 1, y + r, h - 2 * r, c);
    this.circleHelper(x + r, y + r, r, 1, c);
    this.circleHelper(x + w - r - 1, y + r, r, 2, c);
    this.circleHelper(x + w - r - 1, y + h - r - 1, r, 4, c);
    this.circleHelper(x + r, y + h - r - 1, r, 8, c);
  }

  fillRoundRect(x: number, y: number, w: number, h: number, r: number, c: Color): void {
    r = Math.min(Math.round(r), Math.floor(Math.min(w, h) / 2));
    for (let row = 0; row < h; row++) {
      let inset = 0;
      const d = row < r ? r - row : row >= h - r ? row - (h - r - 1) : 0;
      if (d > 0) inset = r - Math.round(Math.sqrt(r * r - d * d));
      this.fillRect(x + inset, y + row, w - 2 * inset, 1, c);
    }
  }

  drawTriangle(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, c: Color): void {
    this.drawLine(x0, y0, x1, y1, c);
    this.drawLine(x1, y1, x2, y2, c);
    this.drawLine(x2, y2, x0, y0, c);
  }

  fillTriangle(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, c: Color): void {
    const pts = [
      [x0, y0],
      [x1, y1],
      [x2, y2],
    ].sort((a, b) => a[1] - b[1]);
    const [[ax, ay], [bx, by], [cx, cy]] = pts;
    const edge = (xa: number, ya: number, xb: number, yb: number, y: number) =>
      yb === ya ? xa : xa + ((xb - xa) * (y - ya)) / (yb - ya);
    for (let y = Math.ceil(ay); y <= Math.floor(cy); y++) {
      const xl = edge(ax, ay, cx, cy, y);
      const xr = y < by ? edge(ax, ay, bx, by, y) : edge(bx, by, cx, cy, y);
      const l = Math.round(Math.min(xl, xr));
      const r = Math.round(Math.max(xl, xr));
      this.fillRect(l, y, r - l + 1, 1, c);
    }
  }

  /** Adafruit-format 1-bit bitmap: rows padded to whole bytes, MSB = leftmost pixel. */
  drawBitmap(x: number, y: number, bitmap: ArrayLike<number>, w: number, h: number, c: Color, bg?: Color): void {
    const stride = Math.ceil(w / 8);
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) {
        const on = bitmap[j * stride + (i >> 3)] & (0x80 >> (i & 7));
        if (on) this.drawPixel(x + i, y + j, c);
        else if (bg !== undefined) this.drawPixel(x + i, y + j, bg);
      }
  }

  drawRGBBitmap(x: number, y: number, px: ArrayLike<number>, w: number, h: number): void {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.drawPixel(x + i, y + j, px[j * w + i]);
  }

  drawSprite(s: Sprite, x: number, y: number, opts: { frame?: number; scale?: number; flipX?: boolean } = {}): void {
    const f = s.frames[(((opts.frame ?? 0) % s.frames.length) + s.frames.length) % s.frames.length];
    const k = Math.max(1, Math.floor(opts.scale ?? 1));
    x = Math.round(x);
    y = Math.round(y);
    for (let j = 0; j < s.height; j++)
      for (let i = 0; i < s.width; i++) {
        const src = j * s.width + (opts.flipX ? s.width - 1 - i : i);
        if (!f.mask[src]) continue;
        if (k === 1) this.drawPixel(x + i, y + j, f.px[src]);
        else this.fillRect(x + i * k, y + j * k, k, k, f.px[src]);
      }
  }

  // ---- text --------------------------------------------------------------------------------

  setCursor(x: number, y: number): void {
    this.cx = Math.round(x);
    this.cy = Math.round(y);
  }
  getCursorX(): number {
    return this.cx;
  }
  getCursorY(): number {
    return this.cy;
  }
  /** One colour = transparent background; two = opaque. */
  setTextColor(fg: Color, bg?: Color): void {
    this.fg = fg;
    this.bg = bg ?? null;
  }
  setTextSize(s: number): void {
    this.size = Math.max(1, Math.floor(s));
  }
  setTextWrap(on: boolean): void {
    this.wrap = on;
  }
  /** null/undefined = built-in 5x7. A string is a CSS font, e.g. 'bold 20px monospace'. */
  setFont(font?: Font | string | null): void {
    if (!font) this.font = font5x7;
    else if (typeof font === 'string') {
      let f = this.fontCache.get(font);
      if (!f) this.fontCache.set(font, (f = browserFont(font)));
      this.font = f;
    } else this.font = font;
  }
  fontHeight(): number {
    return this.font.lineHeight * this.size;
  }
  textWidth(text: string): number {
    let w = 0;
    let last: Glyph | null = null;
    for (const ch of text) {
      last = this.font.glyph(ch);
      w += last.xAdvance * this.size;
    }
    return last ? w - (last.xAdvance - last.w) * this.size : 0;
  }

  print(...args: unknown[]): void {
    for (const ch of args.map(String).join(' ')) this.write(ch);
  }
  println(...args: unknown[]): void {
    this.print(...args);
    this.write('\n');
  }

  /** Draw text without touching the cursor (TFT_eSPI-style). */
  drawString(text: string, x: number, y: number, align: TextAlign = 'left'): void {
    const tw = this.textWidth(text);
    let px = Math.round(align === 'center' ? x - tw / 2 : align === 'right' ? x - tw : x);
    for (const ch of text) {
      const g = this.font.glyph(ch);
      this.drawGlyph(px, Math.round(y), g);
      px += g.xAdvance * this.size;
    }
  }

  private write(ch: string) {
    if (ch === '\n') {
      this.cx = 0;
      this.cy += this.fontHeight();
      return;
    }
    if (ch === '\r') return;
    const g = this.font.glyph(ch);
    if (this.wrap && this.cx + g.xAdvance * this.size > this.w) {
      this.cx = 0;
      this.cy += this.fontHeight();
    }
    this.drawGlyph(this.cx, this.cy, g);
    this.cx += g.xAdvance * this.size;
  }

  private drawGlyph(x: number, y: number, g: Glyph) {
    const s = this.size;
    const cellW = this.bg !== null ? g.xAdvance : g.w;
    for (let row = 0; row < g.h; row++)
      for (let col = 0; col < cellW; col++) {
        const on = col < g.w && g.bits[row * g.w + col];
        if (on) this.fillRect(x + col * s, y + row * s, s, s, this.fg);
        else if (this.bg !== null) this.fillRect(x + col * s, y + row * s, s, s, this.bg);
      }
  }

  /** A native panel pixel in the coordinates apps draw in (the inverse of the rotation). */
  fromNative(nx: number, ny: number): [number, number] {
    switch (this.rot) {
      case 1:
        return [ny, this.fb.width - 1 - nx];
      case 2:
        return [this.fb.width - 1 - nx, this.fb.height - 1 - ny];
      case 3:
        return [this.fb.height - 1 - ny, nx];
      default:
        return [nx, ny];
    }
  }

  // ---- internals ---------------------------------------------------------------------------

  private toNative(x: number, y: number): [number, number] {
    switch (this.rot) {
      case 1:
        return [this.fb.width - 1 - y, x];
      case 2:
        return [this.fb.width - 1 - x, this.fb.height - 1 - y];
      case 3:
        return [y, this.fb.height - 1 - x];
      default:
        return [x, y];
    }
  }

  // Quarter-circle outlines (Adafruit's drawCircleHelper). corners: 1=TL 2=TR 4=BR 8=BL
  private circleHelper(x0: number, y0: number, r: number, corners: number, c: Color) {
    let f = 1 - r;
    let ddx = 1;
    let ddy = -2 * r;
    let x = 0;
    let y = r;
    while (x < y) {
      if (f >= 0) {
        y--;
        ddy += 2;
        f += ddy;
      }
      x++;
      ddx += 2;
      f += ddx;
      if (corners & 4) {
        this.drawPixel(x0 + x, y0 + y, c);
        this.drawPixel(x0 + y, y0 + x, c);
      }
      if (corners & 2) {
        this.drawPixel(x0 + x, y0 - y, c);
        this.drawPixel(x0 + y, y0 - x, c);
      }
      if (corners & 8) {
        this.drawPixel(x0 - y, y0 + x, c);
        this.drawPixel(x0 - x, y0 + y, c);
      }
      if (corners & 1) {
        this.drawPixel(x0 - y, y0 - x, c);
        this.drawPixel(x0 - x, y0 - y, c);
      }
    }
  }
}
