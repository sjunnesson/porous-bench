import { describe, expect, it } from 'vitest';
import { firmwarePrompt } from '../src/resident/firmware';
import { BOARDS, findBoard } from '../src/sim/boards';
import { DEFAULT_PARTS, type PartKind, type PartSpec } from '../src/sim/controls/bench';
import { devices, findDevice } from '../src/sim/devices';
import { ledProfile } from '../src/sim/leds';
import { gpioName, onBoard, PINOUTS, type Wiring, wiring } from '../src/sim/wiring';

const hw = (parts: PartSpec[]) => parts.map((p) => ({ ...p, builtin: false }));
const part = (kind: PartKind, n = 1): PartSpec => ({ id: `${kind}-${n}`, kind, label: `${kind} ${n}` });
const st7789 = findDevice('generic-st7789-240x240')!;
const devkitc = findBoard('esp32-devkitc')!;
const s3 = findBoard('esp32-s3-devkitc-1-n16r8')!;

/** GPIO → every part pin on it. */
function uses(w: Wiring): Map<number, string[]> {
  const m = new Map<number, string[]>();
  for (const p of [...(w.output ? [w.output] : []), ...w.parts])
    for (const x of p.wires) if (x.gpio !== undefined) m.set(x.gpio, [...(m.get(x.gpio) ?? []), `${p.label} ${x.pin}`]);
  return m;
}
const pinOf = (w: Wiring, id: string, pin: string) => w.parts.find((p) => p.id === id)?.wires.find((x) => x.pin === pin)?.gpio;

describe('wiring', () => {
  const every: PartKind[] = ['knob', 'pot', 'button', 'touch', 'imu', 'ld2410', 'pir', 'light', 'climate', 'buzzer'];

  it('wires every kind of part on an ESP32 DevKitC, each GPIO once but the shared I2C bus', () => {
    const w = wiring(st7789, devkitc, hw(every.map((k) => part(k))));
    expect(w.problems).toEqual([]);
    for (const [gpio, who] of uses(w)) {
      if (gpio === 21 || gpio === 22) continue;
      expect(who, `GPIO ${gpio}`).toHaveLength(1);
    }
    // Analog on ADC1 (ADC2 stops reading under Wi-Fi), switches on pins with a pull-up.
    for (const id of ['pot-1', 'light-1']) expect([32, 33, 34, 35, 36, 39]).toContain(w.parts.find((p) => p.id === id)!.wires.find((x) => x.role?.startsWith('ADC1'))!.gpio);
    for (const pin of ['CLK', 'DT', 'SW']) expect([34, 35, 36, 39]).not.toContain(pinOf(w, 'knob-1', pin));
    expect([34, 35, 36, 39]).not.toContain(pinOf(w, 'button-1', '1'));
    expect([4, 13, 14, 27, 32, 33]).toContain(pinOf(w, 'touch-1', 'PAD'));
    expect(pinOf(w, 'imu-1', 'SDA')).toBe(21);
    expect(pinOf(w, 'imu-1', 'SCL')).toBe(22);
    // The radar's TX goes to the board's RX.
    expect(w.parts.find((p) => p.id === 'ld2410-1')!.wires.find((x) => x.pin === 'TX')!.role).toBe('UART RX');
  });

  it('keeps clear of the display\'s pins and wires it too', () => {
    const w = wiring(st7789, devkitc, hw(DEFAULT_PARTS));
    expect(w.output?.wires.map((x) => [x.pin, x.gpio ?? x.rail])).toEqual([
      ['GND', 'GND'],
      ['VCC', '3V3'],
      ['SCL', 18],
      ['SDA', 23],
      ['RES', 17],
      ['DC', 16],
      ['BLK', '3V3'],
    ]);
    for (const [, who] of uses(w)) expect(who).toHaveLength(1);
  });

  it('puts an I2C display and an IMU on one bus', () => {
    const w = wiring(findDevice('ssd1306-128x64')!, s3, hw([part('imu')]));
    const sda = w.output!.wires.find((x) => x.pin === 'SDA')!.gpio;
    expect(sda).toBe(pinOf(w, 'imu-1', 'SDA'));
    expect(w.problems).toEqual([]);
  });

  it('drives LEDs from GPIO 18 and 5V', () => {
    const w = wiring(ledProfile({ kind: 'strip', count: 30 }), s3, hw(DEFAULT_PARTS));
    expect(w.output?.wires.map((x) => x.gpio ?? x.rail)).toEqual(['5V', 18, 'GND']);
    expect([...uses(w).keys()].filter((g) => g === 18)).toHaveLength(1);
  });

  it('wires the same bench the same way, and adding a part moves no wire', () => {
    const a = wiring(st7789, s3, hw(DEFAULT_PARTS));
    const b = wiring(st7789, s3, hw([...DEFAULT_PARTS, part('pir'), part('pot', 2)]));
    for (const p of a.parts) expect(b.parts.find((x) => x.id === p.id)!.wires).toEqual(p.wires);
  });

  it('keeps a part\'s pins together along the header', () => {
    const w = wiring(st7789, s3, hw([part('knob')]));
    expect(['CLK', 'DT', 'SW'].map((p) => pinOf(w, 'knob-1', p))).toEqual([42, 41, 40]);
  });

  it('wires LEDs to a XIAO ESP32S3 by the D-names it prints, and its serial pins last', () => {
    const xiao = findBoard('seeed-xiao-esp32s3')!;
    const strip = ledProfile({ kind: 'strip', count: 30 });
    const w = wiring(strip, xiao, hw([...DEFAULT_PARTS, part('pir')]));
    const din = w.output!.wires.find((x) => x.pin === 'DIN')!.gpio!;
    expect(gpioName(w, din)).toBe('D0 (GPIO 1)');
    expect(w.problems).toEqual([]);
    expect([...uses(w).keys()]).not.toContain(43);
    expect(onBoard(strip, xiao).wiring?.DIN).toBe(1);
    expect(firmwarePrompt(strip, xiao, hw(DEFAULT_PARTS))).toContain('data in on **D0 (GPIO 1)**');
  });

  it('says which part runs out of pins', () => {
    const w = wiring(st7789, devkitc, hw(Array.from({ length: 20 }, (_, i) => part('button', i + 1))));
    expect(w.problems.some((p) => /^button \d+: no free GPIO left/.test(p))).toBe(true);
  });

  it('needs no wires for a board\'s own display and parts', () => {
    const d = findDevice('m5stickc-plus2')!;
    const w = wiring(d, findBoard('m5stickc-plus2')!, [{ id: 'builtin-imu', kind: 'imu', label: 'IMU', builtin: true }]);
    expect(w.output).toBeUndefined();
    expect(w.builtins.map((b) => b.label)).toEqual(['IMU']);
  });

  it('lists only boards Bench has, with each GPIO once and none for flash, PSRAM, USB, straps or the board\'s own parts', () => {
    // What each board's chip, or the board itself, already uses (from the datasheets and schematics).
    const avoid: Record<string, number[]> = {
      'esp32-s3-devkitc-1-n16r8': [0, 3, 45, 46, 19, 20, 43, 44, 35, 36, 37, 38, 48],
      'esp32-devkitc': [0, 1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 12, 15],
      'seeed-xiao-esp32s3': [0, 19, 20, 21, 35, 36, 37, 45, 46],
      'waveshare-esp32-epaper-driver': [0, 1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 25, 26, 27],
      'waveshare-esp32-c6-lcd-1.47': [4, 5, 8, 9, 12, 13, 15, 16, 17],
      'm5stickc-plus2': [0, 25, 34, 38],
      m5sticks3: [0, 3, 19, 20, 43, 44],
      'waveshare-esp32-s3-touch-lcd-2': [0, 3, 19, 20, 43, 44, 45, 46],
      'waveshare-esp32-s3-touch-amoled-1.32': [0, 19, 20, 43, 44],
      'waveshare-esp32-s3-amoled-1.91': [0, 1, 3, 16, 17, 19, 20, 26, 33, 34, 35, 36, 37, 43, 44],
    };
    for (const [id, p] of Object.entries(PINOUTS)) {
      expect(BOARDS.some((b) => b.id === id), id).toBe(true);
      expect(avoid[id], `${id}: say what it must avoid`).toBeDefined();
      const gpios = p.pins.map((g) => g.gpio);
      expect(new Set(gpios).size, id).toBe(gpios.length);
      for (const g of avoid[id]) expect(gpios, `${id} GPIO ${g}`).not.toContain(g);
      for (const g of [p.i2c.sda, p.i2c.scl]) expect(gpios, `${id} I2C`).toContain(g);
      if (p.display) for (const g of Object.values(p.display)) expect([p.i2c.sda, p.i2c.scl], `${id} display`).not.toContain(g);
    }
    // A board with its own display: no pin its display, buttons or sensors use, but the shared I2C bus.
    for (const d of devices) {
      const p = d.boards?.[0] && PINOUTS[d.boards[0]];
      if (!p || !d.wiring) continue;
      for (const [fn, g] of Object.entries(d.wiring)) {
        if (g === p.i2c.sda || g === p.i2c.scl) continue;
        expect(p.pins.map((x) => x.gpio), `${d.id} ${fn}`).not.toContain(g);
      }
    }
  });

  it('knows the pins of every board Bench lists', () => {
    for (const b of BOARDS) expect(PINOUTS[b.id], b.id).toBeDefined();
  });

  it('senses touch with a TTP223 on a chip without touch pins', () => {
    const c6 = findDevice('waveshare-esp32-c6-lcd-1.47')!;
    const w = wiring(c6, findBoard('waveshare-esp32-c6-lcd-1.47')!, hw([part('touch')]));
    expect(w.parts[0].module).toMatch(/TTP223/);
    expect(w.parts[0].wires.find((x) => x.pin === 'I/O')!.gpio).toBeDefined();
    expect(w.output).toBeUndefined();
  });

  it('names pins the way the board prints them', () => {
    const d = findDevice('m5stickc-plus2')!;
    const w = wiring(d, findBoard('m5stickc-plus2')!, hw([part('pot')]));
    expect(w.parts[0].wires.find((x) => x.pin === 'OUT')!.gpio).toBe(36);
    expect(gpioName(w, 36)).toBe('G36/G25');
  });

  it('gives the firmware prompt the same pins', () => {
    const parts = hw(DEFAULT_PARTS);
    const w = wiring(st7789, devkitc, parts);
    const prompt = firmwarePrompt(st7789, devkitc, parts);
    expect(prompt).toContain(`CLK → GPIO ${pinOf(w, 'knob-1', 'CLK')}`);
    expect(prompt).toContain('SCL → GPIO 18 (SPI clock)');
    expect(prompt).toContain("Bench's Wiring view");
  });
});
