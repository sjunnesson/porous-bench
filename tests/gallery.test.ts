import { LuaFactory } from 'wasmoon';
import { describe, expect, it } from 'vitest';
import { ID } from '../api/_share.js';
import entries from '../src/gallery/entries.json';
import { openSetup } from '../src/gallery/open';
import { glassPixel, shakeDetector, TILT_AT_EDGE, tiltAt, unturn } from '../src/gallery/pointer';
import type { Setup } from '../src/share-format';

const factory = new LuaFactory();

/** Run an exhibit's clock forward by `ms`, letting its loop catch up at each step. */
async function runFor(clock: { paused: boolean; advance(ms: number): void }, ms: number) {
  clock.paused = true;
  for (let t = 0; t < ms; t += 20) {
    clock.advance(20);
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
  }
}

describe('gallery entries', () => {
  it('are short share links, each once', () => {
    const list = entries as { id: string; title?: string }[];
    for (const e of list) {
      expect(e.id).toMatch(ID);
      if (e.title !== undefined) expect(typeof e.title).toBe('string');
      expect(Object.keys(e).every((k) => k === 'id' || k === 'title')).toBe(true);
    }
    expect(new Set(list.map((e) => e.id)).size).toBe(list.length);
  });
});

describe('the pointer over a screen', () => {
  it('turns what is on the page back into the panel', () => {
    expect(unturn(1, 0, 0)).toEqual([1, 0]);
    // Turned a quarter clockwise, the panel's top is on the page's right.
    expect(unturn(1, 0, 1)).toEqual([0, -1]);
    expect(unturn(0, 1, 2)).toEqual([-0, -1]);
    expect(unturn(1, 0, 3)).toEqual([-0, 1]);
    expect(unturn(1, 0, 4)).toEqual([1, 0]);
  });

  it('finds the pixel under it, turned or not, and none off the glass', () => {
    // A 172 × 320 panel drawn 86 × 160 CSS px: its top left corner, then the middle of its right edge.
    expect(glassPixel(-43, -80, 0, 86, 160, 172, 320)).toEqual([0, 0]);
    expect(glassPixel(42.9, 0, 0, 86, 160, 172, 320)).toEqual([171, 160]);
    // Turned a quarter clockwise, the panel's top left corner is the page's top right.
    expect(glassPixel(79.9, -42.9, 1, 86, 160, 172, 320)).toEqual([0, 0]);
    expect(glassPixel(44, 0, 0, 86, 160, 172, 320)).toBeNull();
    // Round glass: the square's corner is off it.
    expect(glassPixel(-49, -49, 0, 100, 100, 240, 240, true)).toBeNull();
    expect(glassPixel(0, 0, 0, 100, 100, 240, 240, true)).toEqual([120, 120]);
  });

  it('tilts the side it is over down, in the panel’s frame, as far as the edge gives', () => {
    expect(tiltAt(1, 0, 0)).toEqual({ x: TILT_AT_EDGE, y: 0 });
    expect(tiltAt(0, -2, 0)).toEqual({ x: 0, y: -TILT_AT_EDGE });
    // The page's right is the panel's top when it's turned a quarter clockwise.
    const t = tiltAt(1, 0, 1);
    expect(t.x).toBeCloseTo(0);
    expect(t.y).toBeCloseTo(-TILT_AT_EDGE);
  });

  it('shakes on a quick back and forth, not on a sweep', () => {
    const sweep = shakeDetector();
    expect(Array.from({ length: 40 }, (_, i) => sweep(i * 20, 0, i * 10)).some(Boolean)).toBe(false);
    const jiggle = shakeDetector();
    const xs = [0, 30, 0, 30, 0, 30, 0];
    expect(xs.map((x, i) => jiggle(x, 0, i * 15)).some(Boolean)).toBe(true);
    const slow = shakeDetector();
    expect(xs.map((x, i) => slow(x, 0, i * 200)).some(Boolean)).toBe(false);
  });
});

describe('opening a setup for the gallery', () => {
  const display: Setup = { output: { kind: 'display', device: 'waveshare-esp32-c6-lcd-1.47' }, board: 'waveshare-esp32-c6-lcd-1.47', parts: [], connections: {}, app: { bundled: 'bounce' } };

  it('boots the app as Bench would, and it draws', async () => {
    const ex = openSetup(display, { factory: async () => factory });
    if (typeof ex === 'string') throw new Error(ex);
    expect(ex.name).toBeTruthy();
    const run = ex.start();
    expect(ex.start()).toBe(run); // once
    await runFor(ex.clock, 600);
    expect(run.display.stats.shows).toBeGreaterThan(0);
    run.stop();
  });

  it('runs an LED app on its chain, and your own code by itself', async () => {
    const own: Setup = {
      output: { kind: 'strip', count: 16 },
      board: 'esp32-s3-devkitc-1-n16r8',
      parts: [],
      connections: {},
      app: { name: 'Glow', code: '-- Glow: every LED a dim blue\n-- @output strip\nfunction init(ctx) leds.fill(0x000028) leds.show() end' },
    };
    const ex = openSetup(own, { factory: async () => factory });
    if (typeof ex === 'string') throw new Error(ex);
    expect(ex.name).toBe('Glow');
    expect(ex.description).toBe('Every LED a dim blue');
    const run = ex.start();
    await runFor(ex.clock, 300);
    const rgba = new Uint8ClampedArray(16 * 4);
    run.display.panel.render(ex.clock.now(), rgba);
    expect([rgba[0], rgba[1], rgba[2] > 0]).toEqual([0, 0, true]);
    expect([rgba[60], rgba[61], rgba[62] > 0]).toEqual([0, 0, true]);
    run.stop();
  });

  it("says why it can't open one, and what it leaves out", () => {
    expect(openSetup({ ...display, output: { kind: 'display', device: 'no-such-display' } })).toMatch(/doesn't have the display/);
    expect(openSetup({ ...display, app: { bundled: 'no-such-app' } })).toMatch(/doesn't have the app/);
    const ex = openSetup({ ...display, board: 'no-such-board', parts: [{ id: 'x-1', kind: 'flux-capacitor' as never, label: 'Flux' }] });
    if (typeof ex === 'string') throw new Error(ex);
    expect(ex.missing).toEqual(['the board "no-such-board"', 'the part "flux-capacitor"']);
  });
});
