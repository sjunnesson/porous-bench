// LED outputs: a WS2812B strip, ring or matrix, described as a DeviceProfile with tech 'led' so the
// whole pipeline (frame buffer, bus timing, brightness, the 3D desk) works on it unchanged. The
// chain's LEDs are the frame buffer's pixels, row by row: a strip or ring is N × 1, a matrix W × H.

import type { DeviceProfile } from './devices/types';

export type OutputKind = 'display' | 'strip' | 'ring' | 'matrix';

/** What drives the bench: a display module, or a chain of addressable LEDs. */
export type Output =
  | { kind: 'display'; device: string }
  | { kind: 'strip'; count: number }
  | { kind: 'ring'; count: number }
  | { kind: 'matrix'; w: number; h: number };

export const STRIP_COUNTS = [8, 16, 30, 60, 144];
export const RING_COUNTS = [12, 16, 24];
export const MATRIX_SIZES: [number, number][] = [
  [8, 8],
  [16, 16],
  [32, 8],
];

/** NeoPixel ring outer diameters, mm. */
const RING_OD: Record<number, number> = { 12: 37, 16: 44.5, 24: 66 };

const STRIP_PITCH = 1000 / 144; // a dense 144 LEDs/m strip, so a short one fits the desk

export function ledProfile(o: Exclude<Output, { kind: 'display' }>): DeviceProfile {
  const common = {
    tech: 'led' as const,
    controller: 'WS2812B',
    bus: { kind: 'ws2812' as const, hz: 800_000 },
    wiring: { DIN: 18 },
    url: 'https://cdn-shop.adafruit.com/datasheets/WS2812B.pdf',
  };
  const amps = (n: number) => `At full white each LED draws about 60 mA: ${((n * 60) / 1000).toFixed(1)} A for all ${n}. Budget the 5 V supply, or keep brightness down.`;
  const porting = (n: number) => [
    'Data in through a 330 Ω resistor; a 1000 µF capacitor across 5 V and GND at the start of the chain.',
    'The ESP32 drives 3.3 V data: most WS2812Bs accept it, a 74AHCT125 level shifter makes it certain.',
    amps(n),
    'FastLED / Adafruit_NeoPixel / the ESP-IDF RMT driver all send the whole chain on show().',
  ];
  if (o.kind === 'strip') {
    const n = o.count;
    const len = n * STRIP_PITCH;
    return {
      ...common,
      id: `ws2812-strip-${n}`,
      name: `WS2812B strip · ${n} LEDs`,
      width: n,
      height: 1,
      porting: porting(n),
      enclosure: {
        style: 'pcb',
        body: { w: len + 4, h: 10, d: 0.6, r: 0.6 },
        screen: { x: 0, y: 0 },
        parts: [{ kind: 'header', face: 'front', u: -len / 2 - 0.6, v: 0, pins: 3, along: 'v', label: '5V DIN GND' }],
      },
      look: { activeWidthMm: len, activeHeightMm: STRIP_PITCH, leds: { layout: 'line', pitchMm: STRIP_PITCH } },
    };
  }
  if (o.kind === 'ring') {
    const n = o.count;
    const od = RING_OD[n] ?? (n * 7.5) / Math.PI + 8;
    return {
      ...common,
      id: `ws2812-ring-${n}`,
      name: `WS2812B ring · ${n} LEDs`,
      width: n,
      height: 1,
      porting: porting(n),
      enclosure: {
        style: 'pcb',
        body: { w: od, h: od, d: 1.6, r: od / 2 },
        screen: { x: 0, y: 0 },
        parts: [{ kind: 'hole', face: 'front', u: 0, v: 0, r: od / 2 - 7 }],
      },
      // The "glass" is the whole disc; the LEDs sit on a circle inside it.
      look: { activeWidthMm: od - 1, activeHeightMm: od - 1, cornerRadiusPx: n / 2, leds: { layout: 'ring', pitchMm: (Math.PI * (od - 8)) / n } },
    };
  }
  const { w, h } = o;
  const pitch = w * h <= 64 ? 8 : 10;
  return {
    ...common,
    id: `ws2812-matrix-${w}x${h}`,
    name: `WS2812B matrix · ${w}×${h}`,
    width: w,
    height: h,
    porting: [...porting(w * h), 'Flexible matrices are often wired serpentine (every other row runs backwards); this one is row by row.'],
    enclosure: {
      style: 'pcb',
      body: { w: w * pitch + 4, h: h * pitch + 4, d: 1.2, r: 1 },
      screen: { x: 0, y: 0 },
    },
    look: { activeWidthMm: w * pitch, activeHeightMm: h * pitch, leds: { layout: 'grid', pitchMm: pitch } },
  };
}

/** The profile an output runs on: the display module, or the LED chain. */
export function outputProfile(o: Output, findDevice: (id: string) => DeviceProfile | undefined, fallback: DeviceProfile): DeviceProfile {
  return o.kind === 'display' ? (findDevice(o.device) ?? fallback) : ledProfile(o);
}

/** Which apps fit an output: strip apps run on rings too (both are one chain). */
export function appTarget(o: Output): 'display' | 'strip' | 'matrix' {
  return o.kind === 'ring' ? 'strip' : o.kind;
}

/** LEDs in cells: how big the drawing is (a ring needs a square around its circle). */
export function ledCells(p: DeviceProfile): { w: number; h: number } {
  const layout = p.look.leds?.layout;
  if (layout === 'ring') {
    const d = Math.ceil(p.width / Math.PI) + 3;
    return { w: d, h: d };
  }
  return { w: p.width, h: p.height };
}

/**
 * Draw an LED chain into a rectangle: the black board, each LED's package, and its light as a
 * glowing dot. `rgba` holds each LED's emitted colour (Panel.render output), in chain order.
 */
export function drawLeds(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, p: DeviceProfile, rgba: Uint8ClampedArray, x: number, y: number, w: number, h: number, board = '#0c0c0e'): void {
  const n = p.width * p.height;
  const layout = p.look.leds?.layout ?? 'grid';
  const cells = ledCells(p);
  const cell = Math.min(w / cells.w, h / cells.h);
  const ox = x + (w - cell * cells.w) / 2;
  const oy = y + (h - cell * cells.h) / 2;
  ctx.save();
  ctx.fillStyle = board;
  if (layout === 'ring') {
    ctx.beginPath();
    ctx.arc(x + w / 2, y + h / 2, Math.min(w, h) / 2, 0, Math.PI * 2);
    ctx.fill();
  } else ctx.fillRect(x, y, w, h);

  const centre = (i: number): [number, number] => {
    if (layout === 'ring') {
      const r = (Math.min(w, h) / 2) * 0.78;
      const a = -Math.PI / 2 + (i / n) * Math.PI * 2; // LED 0 at the top, clockwise
      return [x + w / 2 + Math.cos(a) * r, y + h / 2 + Math.sin(a) * r];
    }
    const cx = i % p.width;
    const cy = Math.floor(i / p.width);
    return [ox + (cx + 0.5) * cell, oy + (cy + 0.5) * cell];
  };
  const size = layout === 'ring' ? Math.min(cell, ((Math.min(w, h) / 2) * 0.78 * 2 * Math.PI) / n) : cell;

  // Packages (5050: a pale square with a round window), then light on top.
  for (let i = 0; i < n; i++) {
    const [cx, cy] = centre(i);
    const s = size * 0.62;
    ctx.fillStyle = '#d9d6cc';
    ctx.fillRect(cx - s / 2, cy - s / 2, s, s);
    ctx.fillStyle = '#4a4740';
    ctx.beginPath();
    ctx.arc(cx, cy, s * 0.36, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < n; i++) {
    const r = rgba[i * 4];
    const g = rgba[i * 4 + 1];
    const b = rgba[i * 4 + 2];
    const peak = Math.max(r, g, b);
    if (peak < 4) continue;
    // Eyes see LEDs on a curve: a quarter-brightness LED still looks clearly lit.
    const lum = Math.sqrt(peak / 255);
    const k = 255 / peak; // the hue at full saturation, for the glow
    const hr = Math.round(r * k);
    const hg = Math.round(g * k);
    const hb = Math.round(b * k);
    const [cx, cy] = centre(i);
    // The lit die: covers the package window, white-hot in the middle when bright.
    ctx.globalCompositeOperation = 'source-over';
    const s = size * 0.62;
    ctx.fillStyle = `rgba(${hr},${hg},${hb},${0.35 + 0.65 * lum})`;
    ctx.fillRect(cx - s / 2, cy - s / 2, s, s);
    // The glow around it.
    ctx.globalCompositeOperation = 'lighter';
    const glow = size * (0.7 + lum * 1.1);
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, glow);
    grad.addColorStop(0, `rgba(${Math.min(255, hr + 140 * lum)},${Math.min(255, hg + 140 * lum)},${Math.min(255, hb + 140 * lum)},${Math.min(1, 0.25 + lum)})`);
    grad.addColorStop(0.3, `rgba(${hr},${hg},${hb},${0.75 * lum})`);
    grad.addColorStop(1, `rgba(${hr},${hg},${hb},0)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, glow, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
