import type { DeviceProfile } from './types';

// The board Resident's own examples and in-browser simulator target.
export default {
  id: 'm5stickc-plus2',
  name: 'M5StickC Plus2 (1.14" ST7789V2)',
  tech: 'lcd',
  width: 135,
  height: 240,
  controller: 'ST7789V2',
  bus: { kind: 'spi', hz: 40_000_000 },
  ram: { width: 240, height: 320, offsetX: 52, offsetY: 40 },
  firmwareRotation: 1, // M5.Display.setRotation(1): apps see 240×135 landscape
  builtins: ['imu', 'buzzer'], // MPU6886 and a passive buzzer on the board
  boards: ['m5stickc-plus2'],
  wiring: { MOSI: 15, SCLK: 13, CS: 5, DC: 14, RST: 12, BL: 27, BtnA: 37, BtnB: 39, Buzzer: 2, 'IMU SDA': 21, 'IMU SCL': 22 },
  porting: [
    'Resident firmware: examples/m5stick-demo in inanimate-tech/resident (screen, imu, buzzer, button drivers + lgfx).',
    'Runs landscape: M5.Display.setRotation(1) gives 240×135.',
    'Panel sits at offset (52, 40) in the ST7789 RAM; M5GFX handles it for you.',
    'IMU axes are remapped to the body frame (x/y swapped on the Plus2).',
  ],
  url: 'https://docs.m5stack.com/en/core/M5StickC%20PLUS2',
  enclosure: {
    // 48 × 24 × 13.5 mm. Native portrait; Resident runs it landscape (BtnA to the right of the screen).
    style: 'case',
    body: { w: 24, h: 48, d: 13.5, r: 4.5 },
    screen: { x: 0, y: 6 },
    parts: [
      { kind: 'button', face: 'front', u: 0, v: -15, w: 11, h: 4.4, input: 0, color: '#e9a84c', label: 'BtnA (M5)' },
      { kind: 'button', face: 'right', u: 0, v: 7, w: 3.4, h: 9, input: 1, color: '#8a2a2a', label: 'BtnB' },
      { kind: 'button', face: 'left', u: 0, v: 9, w: 3.4, h: 6, color: '#c9ced8', label: 'Power' },
      { kind: 'port', face: 'bottom', u: 0, v: 0, w: 9, h: 3.2, label: 'USB-C' },
      { kind: 'led', face: 'top', u: 4, v: 0, r: 1.3, color: '#ff4040', label: 'IR / LED' },
    ],
  },
  look: { activeWidthMm: 13.5, activeHeightMm: 24.0, cornerRadiusPx: 4 },
} satisfies DeviceProfile;
