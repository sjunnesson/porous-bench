// The UI's pure parts, without a browser: the wiring diagram rendered to markup, and the 3D desk's
// board outlines.

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BOARDS, boardsFor, findBoard } from '../src/sim/boards';
import { Bench, DEFAULT_PARTS, type PartSpec } from '../src/sim/controls/bench';
import { SimClock } from '../src/sim/clock';
import { devices, findDevice } from '../src/sim/devices';
import type { DeviceProfile } from '../src/sim/devices/types';
import { ledProfile } from '../src/sim/leds';
import type { SketchRun } from '../src/sim/runner';
import { hasOutline } from '../src/ui/three/peripherals';
import { WiringView } from '../src/ui/WiringView';

/** The wiring diagram for this output, board and bench, as HTML. */
function diagram(device: DeviceProfile, boardId: string, parts: PartSpec[] = DEFAULT_PARTS): string {
  const bench = new Bench(new SimClock());
  bench.load(parts);
  const run = { device, bench, controls: [] } as unknown as SketchRun;
  return renderToStaticMarkup(createElement(WiringView, { run, board: findBoard(boardId)! }));
}

describe('the Wiring view', () => {
  it('draws every wire with its GPIO, and asks to check it against the board', () => {
    const html = diagram(findDevice('generic-st7789-240x240')!, 'esp32-devkitc');
    expect(html).toContain('Please verify that the wiring is correct');
    for (const gpio of [18, 23, 17, 16, 19]) expect(html, `GPIO ${gpio}`).toContain(`>GPIO ${gpio}<`);
    expect(html).toContain('BACKLIGHT PWM');
    expect(html).toContain('Before you power it up');
  });

  it('draws a supply of its own for LEDs USB cannot light', () => {
    expect(diagram(ledProfile({ kind: 'strip', count: 144 }), 'esp32-s3-devkitc-1-n16r8')).toContain('OWN 5 V SUPPLY');
    expect(diagram(ledProfile({ kind: 'strip', count: 8 }), 'esp32-s3-devkitc-1-n16r8')).not.toContain('OWN 5 V SUPPLY');
  });

  it("draws the e-paper firmware's key B, and says when there is nothing to wire", () => {
    const html = diagram(findDevice('waveshare-epd-2.13-v4')!, 'esp32-s3-devkitc-1-n16r8', []);
    expect(html).toContain('Key B');
    expect(html).toContain('Key A (the BOOT button)');
    expect(diagram(findDevice('m5stickc-plus2')!, 'm5stickc-plus2', [])).toContain('Nothing to wire');
  });
});

describe('the 3D desk', () => {
  it('draws every board that drives a module or LEDs of its own, and none that is the device', () => {
    // A board with its own display is the only board its display lists.
    const own = new Set(devices.filter((d) => d.boards?.length === 1).map((d) => d.boards![0]));
    const outputs = [...devices, ledProfile({ kind: 'strip', count: 30 })];
    const drivers = new Set(outputs.flatMap((d) => boardsFor(d)).map((b) => b.id).filter((id) => !own.has(id)));
    expect([...drivers].sort()).toEqual(['esp32-devkitc', 'esp32-s3-devkitc-1-n16r8', 'seeed-xiao-esp32s3', 'waveshare-esp32-epaper-driver']);
    for (const id of drivers) expect(hasOutline(id), id).toBe(true);
    for (const b of BOARDS.filter((b) => own.has(b.id))) expect(hasOutline(b.id), b.id).toBe(false);
  });
});
