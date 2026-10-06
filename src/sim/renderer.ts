// Draws a panel onto an HTML canvas the way the physical part looks: scaled pixels, black bezel,
// rounded glass corners, optional pixel grid, and an optional "how it's mounted" rotation.

import type { DeviceProfile } from './devices/types';
import type { Panel } from './panels/panel';

export interface ViewOptions {
  zoom: number;
  grid: boolean;
  /** Quarter turns clockwise: how the module is mounted, independent of setRotation(). */
  rotation: number;
}

export const BEZEL_PX = 14;

export function sceneSize(profile: DeviceProfile, view: ViewOptions): { w: number; h: number } {
  const rotated = view.rotation & 1;
  const pw = (rotated ? profile.height : profile.width) * view.zoom;
  const ph = (rotated ? profile.width : profile.height) * view.zoom;
  return { w: pw + 2 * BEZEL_PX, h: ph + 2 * BEZEL_PX };
}

export function fitZoom(profile: DeviceProfile, rotation: number, availW: number, availH: number): number {
  const w = rotation & 1 ? profile.height : profile.width;
  const h = rotation & 1 ? profile.width : profile.height;
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

    const radius = (profile.look.cornerRadiusPx ?? 0) * view.zoom;
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
    const nw = profile.width * view.zoom;
    const nh = profile.height * view.zoom;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.native, -nw / 2, -nh / 2, nw, nh);

    if (view.grid && view.zoom >= 3) {
      // Gaps between pixels: dark on OLED, faint on LCD, almost invisible on e-paper.
      const alpha = { oled: 0.75, lcd: 0.28, epaper: 0.06 }[profile.tech];
      ctx.fillStyle = `rgba(0,0,0,${alpha})`;
      const line = Math.max(1, Math.round(view.zoom / 6));
      for (let x = 1; x < profile.width; x++) ctx.fillRect(-nw / 2 + x * view.zoom - line / 2, -nh / 2, line, nh);
      for (let y = 1; y < profile.height; y++) ctx.fillRect(-nw / 2, -nh / 2 + y * view.zoom - line / 2, nw, line);
    }
    ctx.restore();

    if (profile.tech === 'lcd') {
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
