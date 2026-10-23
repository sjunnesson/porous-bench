// Drawing with coordinates no screen has: the board's Adafruit_GFX takes them as int16_t, so they wrap
// there, and one such call mustn't hang the tab, where the app's instruction deadline can't stop it.

import { expect, it } from 'vitest';
import { Framebuffer } from '../src/sim/framebuffer';
import { Gfx } from '../src/sim/gfx';

it('draws shapes with huge coordinates quickly, wrapped as the board wraps them', () => {
  const g = new Gfx(new Framebuffer(240, 320, 'rgb565'));
  const start = performance.now();
  g.drawLine(0, 0, 2 ** 40, 1, 0xffff);
  g.drawCircle(120, 160, 2 ** 31, 0xffff);
  g.fillCircle(0, 0, 2 ** 31 - 1, 0xffff);
  g.fillRoundRect(0, 0, 2 ** 40, 2 ** 40, 2 ** 20, 0xffff);
  g.fillTriangle(0, -(2 ** 40), 2 ** 40, 2 ** 40, -(2 ** 40), 5, 0xffff);
  g.fillRect(0, 0, NaN, 10, 0xffff);
  expect(performance.now() - start).toBeLessThan(1000);

  // 65536 + 10 is 10 as an int16_t.
  const a = new Framebuffer(240, 320, 'rgb565');
  const b = new Framebuffer(240, 320, 'rgb565');
  new Gfx(a).drawLine(65536 + 10, 5, 10, 50, 0xffff);
  new Gfx(b).drawLine(10, 5, 10, 50, 0xffff);
  expect(a.data).toEqual(b.data);
});
