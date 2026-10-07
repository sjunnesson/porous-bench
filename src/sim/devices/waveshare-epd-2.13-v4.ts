import type { DeviceProfile } from './types';

export default {
  id: 'waveshare-epd-2.13-v4',
  name: 'Waveshare 2.13" e-Paper V4 (B/W)',
  tech: 'epaper',
  width: 122,
  height: 250,
  controller: 'SSD1680',
  bus: { kind: 'spi', hz: 10_000_000 },
  ram: { width: 176, height: 296, offsetX: 0, offsetY: 0 },
  boards: ['waveshare-esp32-epaper-driver', 'esp32-s3-devkitc-1-n16r8'],
  porting: [
    'Wait on BUSY (high = busy) after every refresh; full refresh ≈ 2 s, partial ≈ 0.3 s.',
    'Partial refresh needs the previous image in the "old" RAM (0x26): write the base image to both RAMs after a full refresh.',
    'Do a full refresh every few partials to clear ghosting.',
    'Rows are 16 bytes wide (122 px rounded up to 128); bit = 1 is white.',
  ],
  enclosure: {
    style: 'pcb',
    body: { w: 29.2, h: 59.2, d: 1.2, r: 1 },
    module: { w: 29.2, h: 56, d: 1.2, r: 0.4, x: 0, y: 1.6 },
    screen: { x: 0, y: 2.6 },
    parts: [{ kind: 'header', face: 'back', u: 0, v: -24, pins: 8, along: 'u', label: 'VCC GND DIN CLK CS DC RST BUSY' }],
  },
  look: { activeWidthMm: 23.71, activeHeightMm: 48.55, light: '#e4e2da', dark: '#1c1c1f' },
  epaper: { fullRefreshMs: 2000, partialRefreshMs: 300, fullRefreshEvery: 10 },
} satisfies DeviceProfile;
