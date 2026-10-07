import type { DeviceProfile } from './types';

// The board on resident.inanimate.tech's "Try it now" simulator.
export default {
  id: 'm5sticks3',
  name: 'M5StickS3 (1.14" ST7789P3)',
  tech: 'lcd',
  width: 135,
  height: 240,
  controller: 'ST7789P3',
  bus: { kind: 'spi', hz: 40_000_000 },
  ram: { width: 240, height: 320, offsetX: 52, offsetY: 40 },
  firmwareRotation: 1,
  builtins: ['imu', 'buzzer'],
  boards: ['m5sticks3'],
  wiring: { BtnA: 11, BtnB: 12 },
  porting: [
    'Resident firmware: examples/m5stick-demo, BOARD_M5STICKS3 (buttons on GPIO 11/12).',
    'Runs landscape: M5.Display.setRotation(1) gives 240×135.',
    'IMU x axis is negated to match the body frame.',
    'ESP32-S3; audio goes through a codec + speaker rather than a bare piezo.',
  ],
  url: 'https://docs.m5stack.com/en/core/StickS3',
  enclosure: {
    style: 'case',
    body: { w: 24, h: 48, d: 15, r: 5 },
    screen: { x: 0, y: 6 },
    parts: [
      { kind: 'button', face: 'front', u: 0, v: -15, w: 11, h: 4.4, input: 0, color: '#e9a84c', label: 'BtnA' },
      { kind: 'button', face: 'right', u: 0, v: 7, w: 3.4, h: 9, input: 1, color: '#8a2a2a', label: 'BtnB' },
      { kind: 'port', face: 'bottom', u: 0, v: 0, w: 9, h: 3.2, label: 'USB-C' },
    ],
  },
  look: { activeWidthMm: 13.5, activeHeightMm: 24.0, cornerRadiusPx: 4 },
} satisfies DeviceProfile;
