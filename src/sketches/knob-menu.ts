import { button, colors, defineSketch, hsv565, knob, pot, type Display } from '../sim';

interface Item {
  label: string;
  value: () => string;
  /** Called with knob clicks while editing. */
  adjust?: (clicks: number) => void;
}

let settings = { brightness: 80, hue: 200, animate: true, invert: false };
let potValue = 0;
let cursor = 0;
let editing = false;
let phase = 0;

const items: Item[] = [
  { label: 'Brightness', value: () => `${settings.brightness}%`, adjust: (c) => (settings.brightness = clamp(settings.brightness + c * 5, 5, 100)) },
  { label: 'Accent', value: () => `${settings.hue}°`, adjust: (c) => (settings.hue = (settings.hue + c * 10 + 360) % 360) },
  { label: 'Animate', value: () => (settings.animate ? 'on' : 'off'), adjust: () => (settings.animate = !settings.animate) },
  { label: 'Invert', value: () => (settings.invert ? 'on' : 'off'), adjust: () => (settings.invert = !settings.invert) },
  { label: 'Pot (ADC)', value: () => `${potValue}` },
];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function draw(d: Display) {
  const W = d.width();
  const H = d.height();
  const color = d.isColor();
  const bg = settings.invert ? colors.WHITE : colors.BLACK;
  const fg = settings.invert ? colors.BLACK : colors.WHITE;
  const accent = color ? hsv565(settings.hue, 0.75, 1) : fg;
  d.fillScreen(bg);

  const rowH = H >= 200 ? 22 : H >= 64 ? 12 : 8;
  const size = H >= 200 ? 2 : 1;
  const titleH = H >= 64 ? rowH : 0;
  if (titleH) {
    d.fillRect(0, 0, W, titleH - 2, accent);
    d.setTextColor(color ? colors.BLACK : bg);
    d.setTextSize(size);
    d.drawString(editing ? 'EDIT' : 'MENU', W / 2, (titleH - 2 - 8 * size) / 2, 'center');
  }

  const visible = Math.floor((H - titleH - (H >= 120 ? 50 : 0)) / rowH);
  const first = clamp(cursor - visible + 1, 0, Math.max(0, items.length - visible));
  d.setTextSize(size);
  for (let i = first; i < Math.min(items.length, first + visible); i++) {
    const y = titleH + (i - first) * rowH;
    const selected = i === cursor;
    if (selected) {
      if (editing) d.drawRoundRect(0, y, W, rowH - 1, 3, accent);
      else d.fillRoundRect(0, y, W, rowH - 1, 3, accent);
    }
    const textColor = selected && !editing ? (color ? colors.BLACK : bg) : fg;
    d.setTextColor(textColor);
    const ty = y + (rowH - 1 - 8 * size) / 2;
    d.drawString(items[i].label, 4, ty);
    d.drawString(items[i].value(), W - 4, ty, 'right');
  }

  // Live gauge driven by the pot, with an optional animation.
  if (H >= 120) {
    const cx = W / 2;
    const cy = H - 8;
    const r = Math.min(W / 2 - 8, 42);
    for (let a = 0; a <= 180; a += 6) {
      const rad = (Math.PI * (180 + a)) / 180;
      d.drawPixel(cx + Math.cos(rad) * r, cy + Math.sin(rad) * r, color ? colors.DARKGREY : fg);
    }
    const v = potValue / 4095;
    const rad = Math.PI * (1 + v);
    d.drawLine(cx, cy, cx + Math.cos(rad) * (r - 4), cy + Math.sin(rad) * (r - 4), accent);
    d.fillCircle(cx, cy, 3, accent);
    if (settings.animate) {
      const px = cx + Math.cos(phase) * (r + 4);
      const py = cy - Math.abs(Math.sin(phase)) * (r + 4);
      d.fillCircle(px, py, 2, color ? hsv565(settings.hue + 120, 0.7, 1) : fg);
    }
  }
}

export default defineSketch({
  name: 'Knob menu',
  description: 'Settings menu on a rotary encoder: turn to move, push to edit, Esc to back out. The pot drives the gauge; Brightness changes the real backlight/contrast.',
  inputs: {
    enc: knob({ label: 'Encoder' }),
    back: button({ label: 'Back', key: 'Escape' }),
    dial: pot({ label: 'Pot', start: 0.4 }),
  },

  setup({ device, display }) {
    if (device.tech === 'epaper') display.setRotation(1);
    settings = { brightness: 80, hue: 200, animate: true, invert: false };
    cursor = 0;
    editing = false;
    phase = 0;
  },

  async loop({ display, inputs, delay, device }) {
    const { enc, back, dial } = inputs;
    const clicks = enc.delta();
    if (enc.wasPressed()) {
      if (items[cursor].adjust) editing = !editing;
    }
    if (back.wasPressed()) editing = false;
    if (clicks) {
      if (editing) items[cursor].adjust?.(clicks);
      else cursor = clamp(cursor + clicks, 0, items.length - 1);
    }
    potValue = dial.read();
    phase += 0.08;

    display.setBrightness(settings.brightness);
    draw(display);
    await display.show();
    await delay(device.tech === 'epaper' ? 200 : 30);
  },
});
