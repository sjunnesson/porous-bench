// Colours are RGB565 numbers, exactly what an ESP32 display library uses, so sketch code ports
// to Adafruit_GFX / TFT_eSPI without changes.

export type Color = number;

export function color565(r: number, g: number, b: number): Color {
  return ((r & 0xf8) << 8) | ((g & 0xfc) << 3) | ((b & 0xff) >> 3);
}

/** '#ff8800' or 'ff8800' → RGB565 */
export function hex565(hex: string): Color {
  const v = parseInt(hex.replace('#', ''), 16);
  return color565((v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff);
}

/** h in degrees, s and v in 0..1 */
export function hsv565(h: number, s: number, v: number): Color {
  h = ((h % 360) + 360) % 360;
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return color565((r + m) * 255, (g + m) * 255, (b + m) * 255);
}

export function rgb565ToRgb(c: Color): [number, number, number] {
  const r = (c >> 11) & 0x1f;
  const g = (c >> 5) & 0x3f;
  const b = c & 0x1f;
  return [(r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2)];
}

/** Perceived brightness 0..255. Mono displays light a pixel when this crosses a threshold. */
export function luminance565(c: Color): number {
  const [r, g, b] = rgb565ToRgb(c);
  return (r * 299 + g * 587 + b * 114) / 1000;
}

export function lerp565(a: Color, b: Color, t: number): Color {
  const [ar, ag, ab] = rgb565ToRgb(a);
  const [br, bg, bb] = rgb565ToRgb(b);
  return color565(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
}

// Same names and values as TFT_eSPI's TFT_* constants.
export const colors = {
  BLACK: 0x0000,
  NAVY: 0x000f,
  DARKGREEN: 0x03e0,
  DARKCYAN: 0x03ef,
  MAROON: 0x7800,
  PURPLE: 0x780f,
  OLIVE: 0x7be0,
  LIGHTGREY: 0xd69a,
  DARKGREY: 0x7bef,
  BLUE: 0x001f,
  GREEN: 0x07e0,
  CYAN: 0x07ff,
  RED: 0xf800,
  MAGENTA: 0xf81f,
  YELLOW: 0xffe0,
  WHITE: 0xffff,
  ORANGE: 0xfda0,
  GREENYELLOW: 0xb7e0,
  PINK: 0xfe19,
  BROWN: 0x9a60,
  GOLD: 0xfea0,
  SILVER: 0xc618,
  SKYBLUE: 0x867d,
  VIOLET: 0x915c,
} as const;
