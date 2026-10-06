import { button, color565, colors, defineSketch, hsv565 } from '../sim';

// Module-level state is (re)initialised in setup(), so restarting the sketch starts fresh.
let ball = { x: 0, y: 0, vx: 0, vy: 0, r: 0 };
let area = { top: 0, bottom: 0 };
let footerY = 0;
let hue = 0;
let frames: number[] = [];
let lastTick = 0;

export default defineSketch({
  name: 'Hello display',
  description: 'Device info, colour bars and a bouncing ball. Adapts itself to LCD, OLED and e-paper. BOOT changes colour.',
  inputs: {
    boot: button({ label: 'BOOT', key: 'Space', gpio: 9 }),
  },

  setup({ display, device, log }) {
    if (device.tech === 'epaper') display.setRotation(1); // e-paper modules are usually mounted landscape
    const W = display.width();
    const H = display.height();
    const color = display.isColor();
    const compact = H < 48;
    const fg = colors.WHITE;

    display.fillScreen(colors.BLACK);
    const headerH = compact ? 0 : H >= 120 ? 22 : 16;
    if (headerH) {
      display.fillRect(0, 0, W, headerH, color ? color565(24, 64, 140) : colors.WHITE);
      display.setTextColor(color ? colors.WHITE : colors.BLACK);
      display.drawString('screenSim', W / 2, (headerH - 8) / 2, 'center');
    }

    display.setTextColor(fg);
    display.setTextWrap(true);
    display.setCursor(2, headerH + 4);
    if (!compact) {
      display.println(device.name);
      display.setTextColor(color ? colors.LIGHTGREY : fg);
      display.println(`${device.width}x${device.height} ${device.controller}`);
    }

    // Colour bars (or 1-bit patterns) along the bottom.
    const barsH = compact ? 0 : Math.max(8, Math.round(H / 8));
    const bars = 8;
    for (let i = 0; i < bars; i++) {
      const x0 = Math.round((i * W) / bars);
      const x1 = Math.round(((i + 1) * W) / bars);
      if (color) display.fillRect(x0, H - barsH, x1 - x0, barsH, hsv565((i * 360) / bars, 1, 1));
      else
        for (let y = H - barsH; y < H; y++)
          for (let x = x0; x < x1; x++) if ((x + y) % (i + 2) === 0) display.drawPixel(x, y, colors.WHITE);
    }

    footerY = H - barsH - 10;
    area = { top: compact ? 0 : display.getCursorY() + 2, bottom: compact ? H - 9 : footerY - 2 };
    const r = Math.max(3, Math.round(Math.min(W, area.bottom - area.top) / 10));
    ball = { x: W / 2, y: (area.top + area.bottom) / 2, vx: W / 90, vy: W / 130, r };
    frames = [];
    hue = 200;
    lastTick = 0;
    log(`Running on ${device.name} — ${W}x${H} after rotation`);
  },

  async loop({ display, inputs, device, millis, delay, log }) {
    const W = display.width();
    const now = millis();
    const epaper = device.tech === 'epaper';
    if (inputs.boot.wasPressed()) {
      hue = (hue + 70) % 360;
      log('BOOT pressed');
    }
    if (epaper && now - lastTick < 5000 && lastTick) {
      await delay(50);
      return;
    }
    lastTick = now;

    // Move the ball: erase, step, draw.
    const bg = colors.BLACK;
    display.fillCircle(ball.x, ball.y, ball.r, bg);
    const steps = epaper ? 25 : 1;
    for (let i = 0; i < steps; i++) {
      ball.x += ball.vx;
      ball.y += ball.vy;
      if (ball.x - ball.r < 0 || ball.x + ball.r >= W) ball.vx = -ball.vx;
      if (ball.y - ball.r < area.top || ball.y + ball.r >= area.bottom) ball.vy = -ball.vy;
      ball.x = Math.min(W - ball.r - 1, Math.max(ball.r, ball.x));
      ball.y = Math.min(area.bottom - ball.r - 1, Math.max(area.top + ball.r, ball.y));
    }
    if (!epaper) hue = (hue + 0.6) % 360;
    display.fillCircle(ball.x, ball.y, ball.r, display.isColor() ? hsv565(hue, 0.8, 1) : colors.WHITE);

    // Footer: uptime and frame rate.
    frames.push(now);
    while (frames.length && now - frames[0] > 1000) frames.shift();
    const footerH = 9;
    display.fillRect(0, footerY, W, footerH, bg);
    display.setTextColor(display.isColor() ? colors.GREENYELLOW : colors.WHITE);
    const text = epaper ? `up ${(now / 1000).toFixed(0)}s` : `${(now / 1000).toFixed(1)}s  ${frames.length} fps`;
    display.drawString(text, 2, footerY + 1);

    await display.show();
    if (!epaper) await delay(16);
  },
});
