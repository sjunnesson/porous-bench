import type { DeviceProfile } from './types';

export default {
  id: 'ssd1306-128x64',
  name: '0.96" OLED 128×64 (SSD1306, I2C)',
  tech: 'oled',
  width: 128,
  height: 64,
  controller: 'SSD1306',
  bus: { kind: 'i2c', hz: 400_000, i2cAddress: 0x3c },
  ram: { width: 128, height: 64, offsetX: 0, offsetY: 0 },
  porting: [
    'At 400 kHz I2C a full 1 KB frame takes ~23 ms, so ~40 fps is the ceiling. Push only changed pages.',
    'Charge pump must be enabled (0x8D 0x14) or the panel stays dark.',
    'Common modules need segment remap (0xA1) and COM scan reverse (0xC8) to appear upright.',
  ],
  enclosure: {
    style: 'pcb',
    body: { w: 27.3, h: 27.8, d: 1.2, r: 1 },
    module: { w: 26.7, h: 19.3, d: 1.4, r: 0.4, x: 0, y: -1.3 },
    screen: { x: 0, y: -0.6 },
    parts: [
      { kind: 'header', face: 'front', u: 0, v: 11.6, pins: 4, along: 'u', label: 'GND VCC SCL SDA' },
      { kind: 'hole', face: 'front', u: -11.6, v: 11.9, r: 1 },
      { kind: 'hole', face: 'front', u: 11.6, v: 11.9, r: 1 },
      { kind: 'hole', face: 'front', u: -11.6, v: -11.9, r: 1 },
      { kind: 'hole', face: 'front', u: 11.6, v: -11.9, r: 1 },
    ],
  },
  look: { activeWidthMm: 21.74, activeHeightMm: 10.86, light: '#eaf4ff', dark: '#000000' },
} satisfies DeviceProfile;
