import { describe, expect, it } from 'vitest';
import { residentApps } from '../src/resident-apps';
import { firmwarePrompt } from '../src/resident/firmware';
import { appNeeds, misfits, outputCaps } from '../src/resident/needs';
import { appPrompt, type PromptInput } from '../src/resident/prompt';
import { boardsFor, findBoard } from '../src/sim/boards';
import { devices, findDevice } from '../src/sim/devices';
import { ledProfile } from '../src/sim/leds';

const epaper = findDevice('waveshare-epd-2.13-v4')!;
const driverBoard = findBoard('waveshare-esp32-epaper-driver')!;
const s3 = findBoard('esp32-s3-devkitc-1-n16r8')!;

/** The bundled apps that run on this output and board. */
const runs = (profile = epaper, board = boardsFor(profile)[0]) =>
  residentApps.filter((a) => misfits(a.needs, outputCaps(profile, board)).length === 0).map((a) => a.id);

describe('app needs', () => {
  it('reads libraries from the code and the rest from the @needs line', () => {
    const n = appNeeds('-- Spin: a spinner\n-- @needs motion color 240x135\nlocal h = lvgl.bind("main")\nscreen.clear()\n');
    expect(n.output).toBe('display');
    expect(n.libraries).toEqual(['lvgl', 'screen']);
    expect(n).toMatchObject({ motion: true, color: true, min: { w: 240, h: 135 } });
    expect(n.ramKb).toBeGreaterThanOrEqual(30); // LVGL's first bind alone
    const plain = appNeeds('-- @output strip\nleds.fill(0xff0000) leds.show()\n');
    expect(plain).toMatchObject({ output: 'strip', libraries: ['leds'], motion: false, color: false });
    expect(plain.min).toBeUndefined();
  });

  it('does not take screens.get for the screen module', () => {
    expect(appNeeds('local s = screens.get("main")\nlocal g = lgfx.bind("main")\n').libraries).toEqual(['lgfx']);
  });

  it("estimates more memory for bigger apps, LVGL and datetime", () => {
    const small = appNeeds('local g = lgfx.bind("main")\n').ramKb;
    expect(appNeeds('local g = lgfx.bind("main")\n' + '-- x\nlocal a = 1\n'.repeat(400)).ramKb).toBeGreaterThan(small);
    expect(appNeeds('local g = lgfx.bind("main")\nlocal t = datetime.now()\n').ramKb).toBeGreaterThan(small + 30);
  });
});

describe('output capabilities', () => {
  it('gives e-paper no motion and no colour, and the board its libraries and memory', () => {
    expect(outputCaps(epaper, driverBoard)).toMatchObject({ output: 'display', w: 122, h: 250, color: false, motion: false, libraries: ['screen', 'lgfx'], appRamKb: 70 });
    expect(outputCaps(epaper, s3).libraries).toContain('lvgl');
  });

  it('measures the screen as apps see it', () => {
    expect(outputCaps(findDevice('m5stickc-plus2')!, findBoard('m5stickc-plus2'))).toMatchObject({ w: 240, h: 135, color: true, motion: true });
  });

  it('offers the paired boards for the e-paper module, and generic ones for bare modules and LEDs', () => {
    expect(boardsFor(epaper).map((b) => b.id)).toEqual(['waveshare-esp32-epaper-driver', 'esp32-s3-devkitc-1-n16r8']);
    expect(boardsFor(findDevice('m5stickc-plus2')!).map((b) => b.id)).toEqual(['m5stickc-plus2']);
    expect(boardsFor(findDevice('ssd1306-128x64')!).length).toBe(2);
    expect(boardsFor(ledProfile({ kind: 'strip', count: 30 })).length).toBe(2);
    expect(outputCaps(ledProfile({ kind: 'strip', count: 30 }), s3).libraries).toEqual(['leds']);
    expect(outputCaps(ledProfile({ kind: 'matrix', w: 8, h: 8 }), s3).libraries).toEqual(['leds', 'lgfx']);
  });

  it('says why an app does not fit', () => {
    const caps = outputCaps(epaper, driverBoard);
    expect(misfits(appNeeds('-- @needs motion color\nlocal h = lvgl.bind("main")\n'), caps)).toEqual(['needs lvgl', 'animates', 'needs colour']);
    expect(misfits(appNeeds('-- @needs 196x96\nscreen.text(40, 80, "from Resident")\n'), caps)).toEqual(['needs 196×96']);
    expect(misfits(appNeeds('-- @output matrix\nleds.show()\n'), caps)).toEqual(['written for an LED matrix']);
  });
});

describe('the App menu', () => {
  it('lists only e-paper apps for the 2.13" e-paper, and only what its board can run', () => {
    // The Waveshare driver board: no LVGL, ~70 KB.
    expect(runs(epaper, driverBoard)).toEqual(['lgfx-hello']);
    // An S3 with PSRAM: Bench's adaptive LVGL apps too, still nothing that animates.
    const onS3 = runs(epaper, s3);
    expect(onS3).toEqual(expect.arrayContaining(['hello-display', 'patterns', 'characters', 'knob-menu', 'ld2410-radar', 'devil', 'lgfx-hello']));
    for (const moving of ['accel', 'bounce', 'tilt-ball', 'lvgl-motion', 'water-sim', 'rainbow']) expect(onS3).not.toContain(moving);
  });

  it('keeps colour apps to colour screens and fixed layouts to screens they fit', () => {
    const oled = runs(findDevice('ssd1306-128x64')!, s3);
    expect(oled).not.toContain('rainbow');
    expect(oled).not.toContain('hello'); // its text runs to x = 196
    expect(oled).toContain('tilt-ball');
    expect(runs(findDevice('m5stickc-plus2')!)).toEqual(expect.arrayContaining(['rainbow', 'hello', 'water-sim', 'hello-display']));
  });

  it('keeps LED apps to their LED output', () => {
    const strip = runs(ledProfile({ kind: 'strip', count: 30 }));
    expect(strip.length).toBeGreaterThan(0);
    expect(strip.every((id) => id.startsWith('led-'))).toBe(true);
    expect(runs(ledProfile({ kind: 'matrix', w: 8, h: 8 }))).toEqual(expect.arrayContaining(['led-marquee', 'led-life', 'led-plasma']));
  });

  it('leaves no bundled app without an output that runs it', () => {
    const outputs = [...devices, ledProfile({ kind: 'strip', count: 30 }), ledProfile({ kind: 'ring', count: 16 }), ledProfile({ kind: 'matrix', w: 8, h: 8 })];
    for (const app of residentApps) {
      const somewhere = outputs.some((d) => boardsFor(d).some((b) => misfits(app.needs, outputCaps(d, b)).length === 0));
      expect(somewhere, app.id).toBe(true);
    }
  });
});

describe('prompts follow the board', () => {
  const base: PromptInput = {
    device: epaper,
    parts: [],
    controls: [],
    app: { id: 'resident:lgfx-hello', name: 'lgfx hello', code: '-- x', bundled: true },
    deviceId: 'sim-abc12345',
    online: false,
  };

  it('tells the app writer what the board has', () => {
    const p = appPrompt({ ...base, board: driverBoard });
    expect(p).toContain('There is no `lvgl` on this board');
    expect(p).toContain('~70 KB of heap');
    expect(p).toContain('`-- @needs motion color 240x135`');
    expect(appPrompt({ ...base, board: s3 })).toContain('optional `lvgl` module');
  });

  it('names the chosen board in the firmware prompt and says whether to build lvgl', () => {
    const p = firmwarePrompt(epaper, driverBoard);
    expect(p).toContain('Waveshare ESP32 e-Paper Driver Board, my choice in Bench');
    expect(p).toContain('Skip `lvgl`');
    expect(firmwarePrompt(epaper, s3)).toContain('Then `lvgl`');
  });
});
