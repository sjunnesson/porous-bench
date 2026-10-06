import type { DeviceProfile } from './types';

export default {
  id: 'generic-st7789-240x240',
  name: '1.3" IPS 240×240 (ST7789)',
  tech: 'lcd',
  width: 240,
  height: 240,
  controller: 'ST7789',
  bus: { kind: 'spi', hz: 40_000_000 },
  ram: { width: 240, height: 320, offsetX: 0, offsetY: 0 },
  porting: [
    'Visible area is the top 240 rows of a 240×320 RAM; rotations 2 and 3 need a row offset of 80.',
    'IPS: needs INVON (0x21).',
  ],
  enclosure: {
    style: 'pcb',
    body: { w: 27.8, h: 39.2, d: 1.6, r: 1 },
    module: { w: 27, h: 30, d: 2.2, r: 0.8, x: 0, y: -3.6 },
    screen: { x: 0, y: -3.6 },
    parts: [{ kind: 'header', face: 'front', u: 0, v: 16.8, pins: 7, along: 'u', label: 'GND VCC SCL SDA RES DC BLK' }],
  },
  look: { activeWidthMm: 23.4, activeHeightMm: 23.4 },
} satisfies DeviceProfile;
