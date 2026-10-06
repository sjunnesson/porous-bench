import type { DeviceProfile } from './types';

export default {
  id: 'ssd1306-128x64-yellow-blue',
  name: '0.96" OLED 128×64 yellow/blue (SSD1306)',
  tech: 'oled',
  width: 128,
  height: 64,
  controller: 'SSD1306',
  bus: { kind: 'i2c', hz: 400_000, i2cAddress: 0x3c },
  porting: [
    'Not a colour display: the glass is tinted, top 16 rows yellow and the rest blue. Lay out a header strip to match.',
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
  look: {
    activeWidthMm: 21.74,
    activeHeightMm: 10.86,
    light: '#46b8ff',
    dark: '#000000',
    accentRows: 16,
    accentColor: '#ffd21f',
  },
} satisfies DeviceProfile;
