import { color565, colors, defineSketch, ld2410, type Color, type Display } from '../sim';

const MAX_CM = 600;
let history: number[] = [];
let lastDraw = 0;
let lastState = -1;
let loggedState = 0;

function stateInfo(moving: boolean, still: boolean): { label: string; color: Color } {
  if (moving) return { label: 'MOVING', color: colors.ORANGE };
  if (still) return { label: 'PRESENT', color: colors.GREEN };
  return { label: 'EMPTY', color: colors.DARKGREY };
}

function bar(d: Display, x: number, y: number, w: number, h: number, value: number, c: Color) {
  d.drawRect(x, y, w, h, d.isColor() ? colors.DARKGREY : colors.WHITE);
  d.fillRect(x + 1, y + 1, Math.round(((w - 2) * value) / 100), h - 2, d.isColor() ? c : colors.WHITE);
}

export default defineSketch({
  name: 'LD2410 radar',
  description: 'Presence dashboard fed by a simulated HLK-LD2410 over UART. Drag the person in the radar panel, or let them wander.',
  inputs: {
    radar: ld2410({ mode: 'wander' }),
  },

  setup({ display, device }) {
    if (device.tech === 'epaper') display.setRotation(1);
    history = [];
    lastDraw = -1e9;
    lastState = -1;
    loggedState = 0;
  },

  async loop({ display, inputs, millis, delay, device, log }) {
    const { radar } = inputs;
    radar.read(); // parse whatever arrived on the UART
    const now = millis();
    const epaper = device.tech === 'epaper';
    const state = (radar.movingTargetDetected() ? 1 : 0) | (radar.stationaryTargetDetected() ? 2 : 0);
    if (state !== loggedState) {
      log(`target state ${loggedState} → ${state} at ${radar.detectionDistance()} cm`);
      loggedState = state;
    }

    // E-paper: only redraw when the state changes or every 10 s. Others: ~12 fps.
    const due = epaper ? state !== lastState || now - lastDraw > 10_000 : now - lastDraw > 80;
    if (!due) {
      await delay(20);
      return;
    }
    lastDraw = now;
    lastState = state;

    const W = display.width();
    const H = display.height();
    const color = display.isColor();
    const dist = radar.detectionDistance();
    history.push(state ? dist : -1);
    if (history.length > W) history.shift();

    const { label, color: stateColor } = stateInfo(radar.movingTargetDetected(), radar.stationaryTargetDetected());
    display.fillScreen(colors.BLACK);
    const fg = colors.WHITE;

    if (H < 48) {
      // Tiny OLED: one line of state, one of distance.
      display.setTextColor(fg);
      display.setTextSize(2);
      display.drawString(label, 0, 0);
      display.setTextSize(1);
      display.drawString(state ? `${(dist / 100).toFixed(2)} m` : '--', 0, 20);
      display.drawString(radar.isConnected() ? 'UART ok' : 'no data', W - 1, 20, 'right');
      await display.show();
      return;
    }

    // Header
    display.setTextSize(1);
    display.setTextColor(color ? colors.LIGHTGREY : fg);
    display.drawString('LD2410', 2, 2);
    display.drawString(radar.isConnected() ? 'UART ok' : 'no data', W - 2, 2, 'right');

    // State badge
    const big = W >= 160 ? 3 : 2;
    display.setTextSize(big);
    const by = 14;
    const bh = 8 * big + 8;
    if (color) display.fillRoundRect(2, by, W - 4, bh, 6, stateColor);
    else if (state) display.fillRoundRect(2, by, W - 4, bh, 4, colors.WHITE);
    else display.drawRoundRect(2, by, W - 4, bh, 4, colors.WHITE);
    display.setTextColor(color ? colors.BLACK : state ? colors.BLACK : colors.WHITE);
    display.drawString(label, W / 2, by + 4, 'center');
    display.setTextSize(1);

    // Distance gauge: horizontal scale 0..6 m with a marker.
    let y = by + bh + 8;
    display.setTextColor(fg);
    display.setTextSize(H >= 200 ? 2 : 1);
    display.drawString(state ? `${(dist / 100).toFixed(2)} m` : '-- m', W / 2, y, 'center');
    y += display.fontHeight() + 4;
    display.setTextSize(1);
    const gx = 6;
    const gw = W - 12;
    display.drawFastHLine(gx, y + 6, gw, color ? colors.DARKGREY : fg);
    for (let m = 0; m <= 6; m++) {
      const tx = gx + (gw * m) / 6;
      display.drawFastVLine(tx, y + 3, 7, color ? colors.DARKGREY : fg);
    }
    if (state) {
      const mx = gx + (gw * Math.min(dist, MAX_CM)) / MAX_CM;
      display.fillTriangle(mx - 4, y - 2, mx + 4, y - 2, mx, y + 5, color ? stateColor : fg);
    }
    y += 14;

    // Energies
    if (H >= 100) {
      display.setTextColor(color ? colors.LIGHTGREY : fg);
      display.drawString(`move ${radar.movingTargetEnergy()}`, 2, y);
      bar(display, 2, y + 10, W - 4, 8, radar.movingTargetEnergy(), colors.ORANGE);
      y += 22;
      display.drawString(`still ${radar.stationaryTargetEnergy()}`, 2, y);
      bar(display, 2, y + 10, W - 4, 8, radar.stationaryTargetEnergy(), colors.GREEN);
      y += 24;
    }

    // Distance history (newest on the right).
    const hTop = y;
    const hBot = H - 3;
    if (hBot - hTop > 16) {
      display.drawRect(0, hTop, W, hBot - hTop + 1, color ? color565(40, 40, 48) : fg);
      for (let i = 0; i < history.length; i++) {
        const v = history[i];
        if (v < 0) continue;
        const px = W - history.length + i;
        const py = hBot - 1 - ((hBot - hTop - 2) * Math.min(v, MAX_CM)) / MAX_CM;
        display.drawPixel(px, py, color ? colors.CYAN : fg);
      }
    }

    await display.show();
  },
});
