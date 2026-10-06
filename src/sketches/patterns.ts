import { button, colors, defineSketch, hsv565, knob, type Display } from '../sim';

type Pattern = { name: string; init?: (W: number, H: number) => void; draw: (d: Display, t: number, W: number, H: number) => void };

// --- Game of Life state
let cells: Uint8Array = new Uint8Array(0);
let cols = 0;
let rows = 0;
const CELL = 4;
let lastGen = 0;

// --- Starfield state
let stars: { x: number; y: number; z: number }[] = [];

const patterns: Pattern[] = [
  {
    name: 'Plasma',
    draw(d, t, W, H) {
      const s = 0.06;
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          const v =
            Math.sin(x * s + t) + Math.sin((y * s + t) * 0.7) + Math.sin((x + y) * s * 0.6 + t * 1.3) + Math.sin(Math.hypot(x - W / 2, y - H / 2) * s);
          d.drawPixel(x, y, hsv565(v * 90 + t * 40, 0.9, 0.5 + v / 8));
        }
    },
  },
  {
    name: 'Rainbow',
    draw(d, t, W, H) {
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x += 2) d.fillRect(x, y, 2, 1, hsv565((x + y) * 1.5 - t * 120, 1, 1));
    },
  },
  {
    name: 'Checker',
    draw(d, t, W, H) {
      const sz = 12;
      const ox = Math.floor(t * 20) % (sz * 2);
      const oy = Math.floor(t * 9) % (sz * 2);
      for (let y = -sz * 2; y < H; y += sz)
        for (let x = -sz * 2; x < W; x += sz) {
          const on = ((x + y) / sz) & 1;
          d.fillRect(x + ox, y + oy, sz, sz, on ? colors.WHITE : colors.BLACK);
        }
    },
  },
  {
    name: 'Rings',
    draw(d, t, W, H) {
      const cx = W / 2 + Math.sin(t * 0.8) * W * 0.2;
      const cy = H / 2 + Math.cos(t * 0.6) * H * 0.2;
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          const r = Math.hypot(x - cx, y - cy);
          const v = Math.sin(r * 0.35 - t * 5);
          d.drawPixel(x, y, hsv565(200 + r, 0.7, (v + 1) / 2));
        }
    },
  },
  {
    name: 'Starfield',
    init() {
      stars = Array.from({ length: 140 }, () => ({ x: Math.random() * 2 - 1, y: Math.random() * 2 - 1, z: Math.random() }));
    },
    draw(d, _t, W, H) {
      d.fillScreen(colors.BLACK);
      for (const s of stars) {
        s.z -= 0.012;
        if (s.z <= 0.02) Object.assign(s, { x: Math.random() * 2 - 1, y: Math.random() * 2 - 1, z: 1 });
        const sx = W / 2 + (s.x / s.z) * W * 0.4;
        const sy = H / 2 + (s.y / s.z) * W * 0.4;
        const b = 1 - s.z;
        if (b > 0.7) d.fillRect(sx, sy, 2, 2, colors.WHITE);
        else d.drawPixel(sx, sy, hsv565(220, 0.3, b + 0.3));
      }
    },
  },
  {
    name: 'Life',
    init(W, H) {
      cols = Math.floor(W / CELL);
      rows = Math.floor(H / CELL);
      cells = Uint8Array.from({ length: cols * rows }, () => (Math.random() < 0.3 ? 1 : 0));
      lastGen = 0;
    },
    draw(d, t) {
      if (t - lastGen > 0.08) {
        lastGen = t;
        const next = new Uint8Array(cells.length);
        for (let y = 0; y < rows; y++)
          for (let x = 0; x < cols; x++) {
            let n = 0;
            for (let dy = -1; dy <= 1; dy++)
              for (let dx = -1; dx <= 1; dx++) if (dx || dy) n += cells[((y + dy + rows) % rows) * cols + ((x + dx + cols) % cols)];
            const alive = cells[y * cols + x];
            next[y * cols + x] = n === 3 || (alive && n === 2) ? 1 : 0;
          }
        cells = next;
      }
      d.fillScreen(colors.BLACK);
      for (let y = 0; y < rows; y++)
        for (let x = 0; x < cols; x++) if (cells[y * cols + x]) d.fillRect(x * CELL, y * CELL, CELL - 1, CELL - 1, hsv565(x * 4 + y * 2, 0.7, 1));
    },
  },
  {
    name: 'Test card',
    draw(d, _t, W, H) {
      d.fillScreen(colors.BLACK);
      for (let x = 0; x < W; x += 10) d.drawFastVLine(x, 0, H, colors.DARKGREY);
      for (let y = 0; y < H; y += 10) d.drawFastHLine(0, y, W, colors.DARKGREY);
      d.drawRect(0, 0, W, H, colors.WHITE);
      const r = Math.min(W, H) / 2 - 4;
      d.drawCircle(W / 2, H / 2, r, colors.WHITE);
      d.drawLine(0, 0, W - 1, H - 1, colors.RED);
      d.drawLine(W - 1, 0, 0, H - 1, colors.GREEN);
      for (let x = 0; x < W; x++) d.drawFastVLine(x, H - 12, 10, hsv565(0, 0, x / W));
      d.setTextColor(colors.WHITE, colors.BLACK);
      d.drawString(`${W}x${H}`, W / 2, H / 2 - 4, 'center');
    },
  },
];

let index = 0;
let t = 0;

export default defineSketch({
  name: 'Patterns',
  description: 'Full-screen generative patterns. Space / knob push = next pattern, knob = speed. 1-bit panels get ordered dithering.',
  inputs: {
    next: button({ label: 'Next', key: 'Space' }),
    speed: knob({ label: 'Speed', min: 1, max: 20, start: 6 }),
  },

  setup({ display, device }) {
    if (device.tech === 'epaper') display.setRotation(1);
    display.setDither(!display.isColor());
    index = 0;
    t = 0;
    patterns[index].init?.(display.width(), display.height());
  },

  async loop({ display, inputs, log, delay }) {
    if (inputs.next.wasPressed() || inputs.speed.wasPressed()) {
      index = (index + 1) % patterns.length;
      patterns[index].init?.(display.width(), display.height());
      log(`pattern: ${patterns[index].name}`);
    }
    t += inputs.speed.getPosition() / 300;
    patterns[index].draw(display, t, display.width(), display.height());
    await display.show();
    await delay(10);
  },
});
