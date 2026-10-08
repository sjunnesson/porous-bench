import type { DeviceProfile } from './types';

export default {
  id: 'waveshare-esp32-c6-lcd-1.47',
  name: 'Waveshare ESP32-C6-LCD-1.47',
  tech: 'lcd',
  width: 172,
  height: 320,
  controller: 'ST7789V3',
  bus: { kind: 'spi', hz: 80_000_000 },
  ram: { width: 240, height: 320, offsetX: 34, offsetY: 0 },
  boards: ['waveshare-esp32-c6-lcd-1.47'],
  wiring: { MOSI: 6, SCLK: 7, CS: 14, DC: 15, RST: 21, BL: 22, 'SD MISO': 5, 'SD CS': 4, 'RGB LED': 8, BOOT: 9 },
  porting: [
    'Column offset 34: the 172 visible columns sit in the middle of the 240-wide ST7789 RAM.',
    'IPS panel: send INVON (0x21) during init or every colour comes out inverted.',
    'Backlight on GPIO22 is plain PWM (ledcAttach/ledcWrite); the screen stays dark until you drive it.',
    'Waveshare demo runs SPI at 80 MHz; RGB565 pixels go out big-endian.',
    'Panel has rounded corners: keep content ~20 px away from them.',
    'Upright (USB-C at the bottom) is the panel\'s native scan, MADCTL 0x00: Adafruit_ST7789\'s rotation 2.',
    'ESP32-C6FH8: 8 MB of flash in the package, no PSRAM.',
    'The RGB LED on GPIO8 takes R, G, B byte order, not a WS2812\'s G, R, B.',
  ],
  url: 'https://docs.waveshare.com/ESP32-C6-LCD-1.47',
  enclosure: {
    // Board outline approximated from product photos; buttons and LED on the back.
    style: 'pcb',
    body: { w: 22, h: 46, d: 1.6, r: 1.5 },
    module: { w: 20.6, h: 36.6, d: 2.6, r: 2.8, x: 0, y: 2.5 },
    screen: { x: 0, y: 2.5 },
    parts: [
      { kind: 'port', face: 'bottom', u: 0, v: -1.6, w: 9, h: 3.2, label: 'USB-C' },
      { kind: 'button', face: 'back', u: -5, v: -16, w: 4, h: 3, input: 0, label: 'BOOT', color: '#d8d8d8' },
      { kind: 'button', face: 'back', u: 5, v: -16, w: 4, h: 3, label: 'RESET', color: '#d8d8d8' },
      { kind: 'led', face: 'back', u: 0, v: -9, r: 1.2, color: '#ff5ad1', label: 'RGB LED' },
      { kind: 'header', face: 'back', u: -9.5, v: 4, pins: 9, along: 'v' },
      { kind: 'header', face: 'back', u: 9.5, v: 4, pins: 9, along: 'v' },
    ],
  },
  look: { activeWidthMm: 17.39, activeHeightMm: 32.35, cornerRadiusPx: 20 },
} satisfies DeviceProfile;
