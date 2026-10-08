import { describe, expect, it } from 'vitest';
import { firmwarePrompt } from '../src/resident/firmware';
import { boardsFor } from '../src/sim/boards';
import { findDevice } from '../src/sim/devices';
import { ledProfile } from '../src/sim/leds';

describe('firmware prompt', () => {
  it('builds Resident\'s own firmware for an M5Stick', () => {
    const p = firmwarePrompt(findDevice('m5stickc-plus2')!);
    expect(p).toContain('examples/m5stick-demo/device');
    expect(p).toContain('pio run -e m5stick -t upload');
    expect(p).toContain('apps see it as 240×135');
    expect(p).toContain('BtnA (M5) = button A (index 0)');
    expect(p).not.toContain('start-building.md');
  });

  it('walks a Waveshare C6 through Resident\'s guide with its pins and C6 platform', () => {
    const p = firmwarePrompt(findDevice('waveshare-esp32-c6-lcd-1.47')!);
    expect(p).toContain('docs/start-building.md');
    expect(p).toContain('MOSI 6, SCLK 7, CS 14, DC 15, RST 21, BL 22');
    expect(p).toContain('x+34');
    expect(p).toContain('pioarduino');
    expect(p).toContain('esp32-c6-devkitc-1');
    expect(p).toContain('ARDUINO_USB_CDC_ON_BOOT=1');
    expect(p).toContain('Real device');
  });

  it('builds Bench\'s own firmware for the C6 on its board', () => {
    const d = findDevice('waveshare-esp32-c6-lcd-1.47')!;
    const p = firmwarePrompt(d, boardsFor(d)[0]);
    expect(p).toContain('`firmware/c6-lcd147/device`');
    expect(p).toContain('tested on hardware');
    expect(p).toContain('device-prebuilt-core');
    expect(p).not.toContain('start-building.md');
  });

  it('asks about the board for a bare module, and drives LEDs with a matching leds module', () => {
    const oled = firmwarePrompt(findDevice('ssd1306-128x64')!);
    expect(oled).toContain('bare display module (pins: GND VCC SCL SDA)');
    expect(oled).toContain('address 0x3c');
    const matrix = firmwarePrompt(ledProfile({ kind: 'matrix', w: 16, h: 16 }));
    expect(matrix).toContain('16×16 matrix');
    expect(matrix).toContain('GPIO 18');
    expect(matrix).toContain('`on_frame(fn, fps)`');
    expect(matrix).not.toContain('`lgfx`');
  });
});
