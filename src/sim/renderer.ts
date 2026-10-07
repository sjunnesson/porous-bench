// Draws a panel onto an HTML canvas the way the physical part looks: scaled pixels, black bezel,
// rounded glass corners, optional pixel grid, and an optional "how it's mounted" rotation.

import type { DeviceProfile } from './devices/types';
import { drawLeds, ledCells } from './leds';
import type { Panel } from './panels/panel';

export interface ViewOptions {
  zoom: number;
  grid: boolean;
  /** Quarter turns clockwise: how the module is mounted, independent of setRotation(). */
  rotation: number;
}

export const BEZEL_PX = 14;
/** LEDs are drawn this many scene pixels apart at zoom 1. */
export const LED_CELL = 22;

/** The drawing's size in scene pixels at zoom 1: pixels for displays, LED cells for LED chains. */
function nativeSize(profile: DeviceProfile): { w: number; h: number } {
  if (profile.tech !== 'led') return { w: profile.width, h: profile.height };
  const c = ledCells(profile);
  return { w: c.w * LED_CELL, h: c.h * LED_CELL };
}

export function sceneSize(profile: DeviceProfile, view: ViewOptions): { w: number; h: number } {
  const rotated = view.rotation & 1;
  const n = nativeSize(profile);
  const pw = (rotated ? n.h : n.w) * view.zoom;
  const ph = (rotated ? n.w : n.h) * view.zoom;
  return { w: pw + 2 * BEZEL_PX, h: ph + 2 * BEZEL_PX };
}

export function fitZoom(profile: DeviceProfile, rotation: number, availW: number, availH: number): number {
  const n = nativeSize(profile);
  const w = rotation & 1 ? n.h : n.w;
  const h = rotation & 1 ? n.w : n.h;
  const z = Math.floor(Math.min((availW - 2 * BEZEL_PX) / w, (availH - 2 * BEZEL_PX) / h));
  return Math.max(1, Math.min(10, z));
}

export class PanelRenderer {
  private native: HTMLCanvasElement;
  private image: ImageData;

  constructor(private profile: DeviceProfile) {
    this.native = document.createElement('canvas');
    this.native.width = profile.width;
    this.native.height = profile.height;
    this.image = new ImageData(profile.width, profile.height);
  }

  /** Draw at sim time `now`. Resizes `canvas` for the device pixel ratio as needed. */
  draw(canvas: HTMLCanvasElement, panel: Panel, now: number, view: ViewOptions): void {
    const { profile } = this;
    const dpr = window.devicePixelRatio || 1;
    const { w, h } = sceneSize(profile, view);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    }

    panel.render(now, this.image.data);
    this.native.getContext('2d')!.putImageData(this.image, 0, 0);

    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const radius = profile.tech === 'led' ? 0 : (profile.look.cornerRadiusPx ?? 0) * view.zoom;
    const pw = w - 2 * BEZEL_PX;
    const ph = h - 2 * BEZEL_PX;

    // Bezel / inactive glass
    ctx.fillStyle = profile.tech === 'epaper' ? '#d8d6cf' : '#0b0b0d';
    roundRect(ctx, 0, 0, w, h, radius + BEZEL_PX * 0.8);
    ctx.fill();

    ctx.save();
    roundRect(ctx, BEZEL_PX, BEZEL_PX, pw, ph, radius);
    ctx.clip();
    ctx.translate(BEZEL_PX + pw / 2, BEZEL_PX + ph / 2);
    ctx.rotate((view.rotation * Math.PI) / 2);
    const ns = nativeSize(profile);
    const nw = ns.w * view.zoom;
    const nh = ns.h * view.zoom;
    if (profile.tech === 'led') {
      // LEDs: the board, the packages and each one's light.
      drawLeds(ctx, profile, this.image.data, -nw / 2, -nh / 2, nw, nh);
      ctx.restore();
      return;
    }
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.native, -nw / 2, -nh / 2, nw, nh);

    if (view.grid && view.zoom >= 3) {
      // Gaps between pixels: dark on OLED, faint on LCD, almost invisible on e-paper.
      const alpha = { oled: 0.75, amoled: 0.5, lcd: 0.28, epaper: 0.06, led: 0 }[profile.tech];
      ctx.fillStyle = `rgba(0,0,0,${alpha})`;
      const line = Math.max(1, Math.round(view.zoom / 6));
      for (let x = 1; x < profile.width; x++) ctx.fillRect(-nw / 2 + x * view.zoom - line / 2, -nh / 2, line, nh);
      for (let y = 1; y < profile.height; y++) ctx.fillRect(-nw / 2, -nh / 2 + y * view.zoom - line / 2, nw, line);
    }
    ctx.restore();

    if (profile.tech === 'lcd' || profile.tech === 'amoled') {
      // A hint of glass reflection.
      ctx.save();
      roundRect(ctx, BEZEL_PX, BEZEL_PX, pw, ph, radius);
      ctx.clip();
      const g = ctx.createLinearGradient(0, BEZEL_PX, pw, ph);
      g.addColorStop(0, 'rgba(255,255,255,0.05)');
      g.addColorStop(0.45, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(BEZEL_PX, BEZEL_PX, pw, ph);
      ctx.restore();
    }
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
}
