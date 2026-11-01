// Drawing API modelled on Adafruit_GFX (with a few TFT_eSPI extras like drawString), so a sketch
// written here reads almost line-for-line like its C++ port.

import { type Color, color565, colors } from './color';
import { browserFont, type Font, font5x7, type Glyph } from './fonts/font';
import type { Framebuffer } from './framebuffer';
import type { Sprite } from './sprite';

export type TextAlign = 'left' | 'center' | 'right';

/**
 * A coordinate as Adafruit_GFX takes it, an int16_t: a bigger one wraps on the board, and here too.
 * It also bounds the shapes that are drawn step by step (lines, circles, triangles, rounded rects),
 * so one call from an app can't run for minutes where the instruction deadline can't stop it.
 */
const s16 = (v: number) => (!(Math.abs(v) > 32767) ? v : (Math.trunc(v) << 16) >> 16); // NaN stays NaN: nothing is drawn

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
  /** Drawing stays inside [x0, x1) x [y0, y1), in the app's coordinates, until clearClipRect(). */
  private clip: [number, number, number, number] | null = null;
  /** Lines as Adafruit GFX's writeLine steps them (a canvas without a line of its own: the e-paper
   *  board's); otherwise Bresenham's, as the colour boards' canvas draws them. */
  protected adafruitLines = false;

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

  // ---- clipping ----------------------------------------------------------------------------

  /** As LovyanGFX's: everything drawn stays inside the rectangle until clearClipRect(). */
  setClipRect(x: number, y: number, w: number, h: number): void {
    x = Math.floor(x);
    y = Math.floor(y);
    this.clip = [x, y, x + Math.floor(w), y + Math.floor(h)];
  }
  clearClipRect(): void {
    this.clip = null;
  }

  // ---- pixels & shapes ---------------------------------------------------------------------

  fillScreen(c: Color): void {
    const k = this.clip;
    if (k) return this.fillRect(k[0], k[1], k[2] - k[0], k[3] - k[1], c);
    this.fb.fill(0, 0, this.fb.width - 1, this.fb.height - 1, c);
  }

  drawPixel(x: number, y: number, c: Color): void {
    x = s16(Math.floor(x));
    y = s16(Math.floor(y));
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const k = this.clip;
    if (k && (x < k[0] || y < k[1] || x >= k[2] || y >= k[3])) return;
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
    if (this.fb.format === 'rgb888') return color565((v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff);
    return this.fb.format === 'rgb565' ? v : v ? colors.WHITE : colors.BLACK;
  }

  /** Draw without the clip rectangle (a library that writes the buffer itself), then keep it. */
  unclipped(draw: () => void): void {
    const k = this.clip;
    this.clip = null;
    try {
      draw();
    } finally {
      this.clip = k;
    }
  }

  /** A pixel in 0xRRGGBB, kept whole where the buffer holds 8 bits a channel (an LED chain). */
  drawPixelRgb(x: number, y: number, rgb: number): void {
    x = Math.floor(x);
    y = Math.floor(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const k = this.clip;
    if (k && (x < k[0] || y < k[1] || x >= k[2] || y >= k[3])) return;
    const [nx, ny] = this.toNative(x, y);
    this.fb.setRgb(nx, ny, rgb);
  }
  getPixelRgb(x: number, y: number): number {
    x = Math.floor(x);
    y = Math.floor(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
    const [nx, ny] = this.toNative(x, y);
    return this.fb.getRgb(nx, ny);
  }

  /** As the boards' canvas fills: in 16-bit coordinates, nothing for a width of 0 or less, and a
   *  negative height upwards from y (rows y + h + 1 to y). */
  fillRect(x: number, y: number, w: number, h: number, c: Color): void {
    x = s16(Math.floor(x));
    y = s16(Math.floor(y));
    w = s16(Math.floor(w));
    h = s16(Math.floor(h));
    if (!(w > 0) || h === 0) return;
    if (h < 0) {
      y += h + 1;
      h = -h;
    }
    const k = this.clip;
    let x0 = Math.max(0, x, k ? k[0] : 0);
    let y0 = Math.max(0, y, k ? k[1] : 0);
    let x1 = Math.min(this.w - 1, x + w - 1, k ? k[2] - 1 : Infinity);
    let y1 = Math.min(this.h - 1, y + h - 1, k ? k[3] - 1 : Infinity);
    if (!(x1 >= x0 && y1 >= y0)) return; // also NaN
    const [ax, ay] = this.toNative(x0, y0);
    const [bx, by] = this.toNative(x1, y1);
    x0 = Math.min(ax, bx);
    x1 = Math.max(ax, bx);
    y0 = Math.min(ay, by);
    y1 = Math.max(ay, by);
    this.fb.fill(x0, y0, x1, y1, c);
  }

  /** A negative length runs left (up) from x (y), as Adafruit's does: what drawRect's corners rely on. */
  drawFastHLine(x: number, y: number, w: number, c: Color): void {
    w = s16(Math.floor(w));
    if (w < 0) {
      x = Math.floor(x) + w + 1;
      w = -w;
    }
    this.fillRect(x, y, w, 1, c);
  }
  drawFastVLine(x: number, y: number, h: number, c: Color): void {
    h = s16(Math.floor(h));
    if (h < 0) {
      y = Math.floor(y) + h + 1;
      h = -h;
    }
    this.fillRect(x, y, 1, h, c);
  }

  drawRect(x: number, y: number, w: number, h: number, c: Color): void {
    this.drawFastHLine(x, y, w, c);
    this.drawFastHLine(x, y + h - 1, w, c);
    this.drawFastVLine(x, y, h, c);
    this.drawFastVLine(x + w - 1, y, h, c);
  }

  drawLine(x0: number, y0: number, x1: number, y1: number, c: Color): void {
    x0 = s16(Math.round(x0));
    y0 = s16(Math.round(y0));
    x1 = s16(Math.round(x1));
    y1 = s16(Math.round(y1));
    if (x0 === x1) return this.fillRect(x0, Math.min(y0, y1), 1, Math.abs(y1 - y0) + 1, c);
    if (y0 === y1) return this.fillRect(Math.min(x0, x1), y0, Math.abs(x1 - x0) + 1, 1, c);
    if (this.adafruitLines) return this.writeLine(x0, y0, x1, y1, c);
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
    x0 = s16(Math.round(x0));
    y0 = s16(Math.round(y0));
    r = s16(Math.round(r));
    this.drawPixel(x0, y0 + r, c);
    this.drawPixel(x0, y0 - r, c);
    this.drawPixel(x0 + r, y0, c);
    this.drawPixel(x0 - r, y0, c);
    this.circleHelper(x0, y0, r, 0xf, c);
  }

  /** Adafruit GFX's: a centre line, then the midpoint helper's columns either side. */
  fillCircle(x0: number, y0: number, r: number, c: Color): void {
    x0 = s16(Math.round(x0));
    y0 = s16(Math.round(y0));
    r = s16(Math.round(r));
    this.drawFastVLine(x0, y0 - r, 2 * r + 1, c);
    this.fillCircleHelper(x0, y0, r, 3, 0, c);
  }

  drawRoundRect(x: number, y: number, w: number, h: number, r: number, c: Color): void {
    [x, y, w, h, r] = [s16(x), s16(y), s16(w), s16(h), s16(r)];
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

  /** Adafruit GFX's: the middle as a rectangle, the ends as half circles stretched down the sides. */
  fillRoundRect(x: number, y: number, w: number, h: number, r: number, c: Color): void {
    [x, y, w, h, r] = [x, y, w, h, r].map((v) => s16(Math.round(v)));
    const most = Math.trunc((w < h ? w : h) / 2);
    if (r > most) r = most;
    this.fillRect(x + r, y, w - 2 * r, h, c);
    this.fillCircleHelper(x + w - r - 1, y + r, r, 1, h - 2 * r - 1, c);
    this.fillCircleHelper(x + r, y + r, r, 2, h - 2 * r - 1, c);
  }

  drawTriangle(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, c: Color): void {
    this.drawLine(x0, y0, x1, y1, c);
    this.drawLine(x1, y1, x2, y2, c);
    this.drawLine(x2, y2, x0, y0, c);
  }

  /** Adafruit GFX's: rows between the edges, stepped in whole numbers as it steps them (the C
   *  division truncates), the middle corner's row with the lower half unless the bottom is flat. */
  fillTriangle(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, c: Color): void {
    [x0, y0, x1, y1, x2, y2] = [x0, y0, x1, y1, x2, y2].map((v) => s16(Math.round(v)));
    if (y0 > y1) [x0, y0, x1, y1] = [x1, y1, x0, y0];
    if (y1 > y2) [x1, y1, x2, y2] = [x2, y2, x1, y1];
    if (y0 > y1) [x0, y0, x1, y1] = [x1, y1, x0, y0];
    if (y0 === y2) {
      // All on one row: from the leftmost to the rightmost.
      let a = x0;
      let b = x0;
      if (x1 < a) a = x1;
      else if (x1 > b) b = x1;
      if (x2 < a) a = x2;
      else if (x2 > b) b = x2;
      this.drawFastHLine(a, y0, b - a + 1, c);
      return;
    }
    const [dx01, dy01, dx02, dy02, dx12, dy12] = [x1 - x0, y1 - y0, x2 - x0, y2 - y0, x2 - x1, y2 - y1];
    const span = (a: number, b: number, y: number) => {
      if (a > b) [a, b] = [b, a];
      this.drawFastHLine(a, y, b - a + 1, c);
    };
    let sa = 0;
    let sb = 0;
    let y = y0;
    for (const last = y1 === y2 ? y1 : y1 - 1; y <= last; y++) {
      span(s16(x0 + Math.trunc(sa / dy01)), s16(x0 + Math.trunc(sb / dy02)), y);
      sa += dx01;
      sb += dx02;
    }
    sa = dx12 * (y - y1);
    sb = dx02 * (y - y0);
    for (; y <= y2; y++) {
      span(s16(x1 + Math.trunc(sa / dy12)), s16(x0 + Math.trunc(sb / dy02)), y);
      sa += dx12;
      sb += dx02;
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
    this.bg = bg === undefined || bg === fg ? null : bg; // the same colour twice: no background, as Adafruit's GFX
  }
  setTextSize(s: number): void {
    this.size = Number.isFinite(s) ? Math.max(1, Math.floor(s)) : 1; // 0/0 as a board's int cast reads it: usable
  }
  get textSize(): number {
    return this.size;
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
  /** What a string draws as: its UTF-8 bytes for the classic font (as Adafruit's print), else its characters. */
  private chars(text: string): Iterable<string> {
    return this.font.bytes ? Array.from(new TextEncoder().encode(text), (b) => String.fromCharCode(b)) : text;
  }

  textWidth(text: string): number {
    let w = 0;
    let last: Glyph | null = null;
    for (const ch of this.chars(text)) {
      last = this.font.glyph(ch);
      w += last.xAdvance * this.size;
    }
    return last ? w - (last.xAdvance - last.w) * this.size : 0;
  }

  print(...args: unknown[]): void {
    for (const ch of this.chars(args.map(String).join(' '))) this.write(ch);
  }
  println(...args: unknown[]): void {
    this.print(...args);
    this.write('\n');
  }

  /** Draw text without touching the cursor (TFT_eSPI-style). */
  drawString(text: string, x: number, y: number, align: TextAlign = 'left'): void {
    const tw = this.textWidth(text);
    let px = Math.round(align === 'center' ? x - tw / 2 : align === 'right' ? x - tw : x);
    for (const ch of this.chars(text)) {
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
  /** Adafruit GFX's writeLine: x steps along the longer axis, the error starts at half of it. */
  private writeLine(x0: number, y0: number, x1: number, y1: number, c: Color) {
    const steep = Math.abs(y1 - y0) > Math.abs(x1 - x0);
    if (steep) [x0, y0, x1, y1] = [y0, x0, y1, x1];
    if (x0 > x1) [x0, y0, x1, y1] = [x1, y1, x0, y0];
    const dx = x1 - x0;
    const dy = Math.abs(y1 - y0);
    let err = Math.trunc(dx / 2);
    const ystep = y0 < y1 ? 1 : -1;
    for (; x0 <= x1; x0++) {
      if (steep) this.drawPixel(y0, x0, c);
      else this.drawPixel(x0, y0, c);
      err -= dy;
      if (err < 0) {
        y0 += ystep;
        err += dx;
      }
    }
  }

  /** Adafruit GFX's fillCircleHelper: the right (1) and/or left (2) half of a circle as columns,
   *  each `delta` longer (a rounded rectangle's height between its corners). */
  private fillCircleHelper(x0: number, y0: number, r: number, corners: number, delta: number, c: Color) {
    let f = 1 - r;
    let ddFx = 1;
    let ddFy = -2 * r;
    let x = 0;
    let y = r;
    let px = x;
    let py = y;
    delta++;
    while (x < y) {
      if (f >= 0) {
        y--;
        ddFy += 2;
        f += ddFy;
      }
      x++;
      ddFx += 2;
      f += ddFx;
      if (x < y + 1) {
        if (corners & 1) this.drawFastVLine(x0 + x, y0 - y, 2 * y + delta, c);
        if (corners & 2) this.drawFastVLine(x0 - x, y0 - y, 2 * y + delta, c);
      }
      if (y !== py) {
        if (corners & 1) this.drawFastVLine(x0 + py, y0 - px, 2 * px + delta, c);
        if (corners & 2) this.drawFastVLine(x0 - py, y0 - px, 2 * px + delta, c);
        py = y;
      }
      px = x;
    }
  }

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
