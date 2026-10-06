import type { DeviceProfile } from './types';

export default {
  id: 'ssd1306-128x32',
  name: '0.91" OLED 128×32 (SSD1306, I2C)',
  tech: 'oled',
  width: 128,
  height: 32,
  controller: 'SSD1306',
  bus: { kind: 'i2c', hz: 400_000, i2cAddress: 0x3c },
  ram: { width: 128, height: 64, offsetX: 0, offsetY: 0 },
  porting: ['Init with multiplex 0x1F and COM pins 0x02, or every other row is lost.'],
  enclosure: {
    style: 'pcb',
    body: { w: 38, h: 12, d: 1.2, r: 0.8 },
    module: { w: 30, h: 11.5, d: 1.4, r: 0.3, x: 3.2, y: 0 },
    screen: { x: 3.2, y: 0 },
    parts: [{ kind: 'header', face: 'front', u: -16.5, v: 0, pins: 4, along: 'v', label: 'GND VCC SCL SDA' }],
  },
  look: { activeWidthMm: 22.38, activeHeightMm: 5.58, light: '#eaf4ff', dark: '#000000' },
} satisfies DeviceProfile;
