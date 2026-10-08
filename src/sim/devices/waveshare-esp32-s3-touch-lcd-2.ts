import type { DeviceProfile } from './types';

// Pins from Waveshare's demo code (ESP-IDF 06_lvgl_example, Arduino 02_gfx_helloworld and
// 04_qmi8658_output) and schematic; dimensions from the product drawing.
export default {
  id: 'waveshare-esp32-s3-touch-lcd-2',
  name: 'Waveshare ESP32-S3-Touch-LCD-2',
  tech: 'lcd',
  touch: { controller: 'CST816D', i2cAddress: 0x15 },
  width: 240,
  height: 320,
  controller: 'ST7789T3',
  bus: { kind: 'spi', hz: 80_000_000 },
  ram: { width: 240, height: 320, offsetX: 0, offsetY: 0 },
  boards: ['waveshare-esp32-s3-touch-lcd-2'],
  builtins: ['imu'], // QMI8658
  wiring: {
    MOSI: 38,
    SCLK: 39,
    MISO: 40,
    CS: 45,
    DC: 42,
    BL: 1,
    'I2C SDA': 48,
    'I2C SCL': 47,
    'SD CS': 41,
    BOOT: 0,
    'Battery ADC': 5,
  },
  porting: [
    'ST7789T3 IPS LCD over SPI at 80 MHz, as Waveshare\'s demo runs it, native 240×320 portrait with no RAM offset. Send INVON (0x21) or every colour comes out inverted. RGB565 pixels go out big-endian.',
    'The LCD\'s reset is not wired to a GPIO (RST -1 in the demos): reset it with the software reset command (0x01).',
    'Backlight on GPIO1 is plain PWM (Waveshare runs it at 10 kHz, 10-bit); the screen stays dark until you drive it.',
    'The TF card shares the display\'s SPI bus (MOSI 38, SCLK 39, MISO 40) with its own CS on GPIO41.',
    'ESP32-S3R8: 8 MB octal PSRAM (board_build.arduino.memory_type = qio_opi), 16 MB flash. A full RGB565 frame is 240 × 320 × 2 = 150 KB: keep it in PSRAM.',
    'Native USB only: build with -DARDUINO_USB_MODE=1 -DARDUINO_USB_CDC_ON_BOOT=1 or serial stays silent; hold BOOT while pressing RST if the port doesn\'t show up.',
    'One user key: BOOT on GPIO0 (active low), button A. The other key is RST.',
    'Touch: CST816D at I2C 0x15 on the shared bus (SDA 48, SCL 47); Waveshare\'s demos poll it and leave its INT and RST unused. It reports one finger in panel pixels. Expose it as Bench\'s `touchscreen` module and `touch_*` events.',
    'QMI8658 IMU at I2C 0x6B on the same bus: Bench\'s `imu` module.',
    'Battery voltage on GPIO5 (ADC1 channel 4) through a divider. The 24-pin camera connector takes an OV2640 or OV5640.',
  ],
  url: 'https://docs.waveshare.com/ESP32-S3-Touch-LCD-2',
  enclosure: {
    // A 35 × 48.2 mm board behind a 37.1 × 58.8 mm display module (corner radius 2.6), ~7.2 mm thick
    // without the pin headers. The glass overhangs the board, more at the top; its visible window
    // (31 × 41.2 mm, around a 30.6 × 40.8 mm active area) sits 7.5 mm from the top edge and 10.3 mm
    // from the bottom. Headers on a 30.48 mm
    // pitch; USB-C at the bottom between RST and BOOT. Placement of the parts on the back is approximate.
    style: 'pcb',
    body: { w: 35, h: 48.2, d: 1.6, r: 1.5 },
    module: { w: 37.1, h: 58.8, d: 4.5, r: 2.6, x: 0, y: 0.5 },
    screen: { x: 0, y: 1.9 },
    parts: [
      { kind: 'port', face: 'bottom', u: 0, v: -1.6, w: 9, h: 3.2, label: 'USB-C' },
      { kind: 'button', face: 'back', u: -9.45, v: -21.5, w: 3.5, h: 3, input: 0, label: 'BOOT', color: '#d8d8d8' },
      { kind: 'button', face: 'back', u: 9.45, v: -21.5, w: 3.5, h: 3, label: 'RST', color: '#d8d8d8' },
      { kind: 'header', face: 'back', u: -15.24, v: 0, pins: 14, along: 'v' },
      { kind: 'header', face: 'back', u: 15.24, v: 0, pins: 14, along: 'v' },
      { kind: 'port', face: 'back', u: 0, v: 11, w: 11, h: 10, label: 'TF card' },
      { kind: 'port', face: 'back', u: 0, v: -12, w: 14, h: 3, label: 'Camera 24-pin' },
      { kind: 'port', face: 'back', u: -6.5, v: -6, w: 5, h: 3, label: 'BAT' },
    ],
  },
  look: { activeWidthMm: 30.6, activeHeightMm: 40.8, cornerRadiusPx: 4 },
} satisfies DeviceProfile;
