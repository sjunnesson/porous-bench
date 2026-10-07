import type { DeviceProfile } from './types';

// Pins from Waveshare's pinout diagram, schematic and demo code (example_qspi_with_ram.c);
// dimensions from the wiki's product drawing. The touch version is the same board plus an FT3168
// touch panel (waveshare-esp32-s3-touch-amoled-1.91.ts).
export default {
  id: 'waveshare-esp32-s3-amoled-1.91',
  name: 'Waveshare ESP32-S3-AMOLED-1.91',
  tech: 'amoled',
  width: 240,
  height: 536,
  controller: 'RM67162',
  bus: { kind: 'qspi', hz: 40_000_000 },
  ram: { width: 240, height: 536, offsetX: 0, offsetY: 0 },
  firmwareRotation: 1, // Waveshare's demo runs it landscape (MADCTL 0xF0): apps see 536×240
  boards: ['waveshare-esp32-s3-amoled-1.91'],
  builtins: ['imu'], // QMI8658
  wiring: {
    'QSPI CS': 6,
    'QSPI CLK': 47,
    'QSPI D0': 18,
    'QSPI D1': 7,
    'QSPI D2': 48,
    'QSPI D3': 5,
    RST: 17,
    'I2C SDA': 40,
    'I2C SCL': 39,
    'IMU INT1': 45,
    'IMU INT2': 46,
    BOOT: 0,
    'Battery ADC': 1,
    'SD MOSI': 42,
    'SD MISO': 8,
    'SD CS': 9,
  },
  porting: [
    'RM67162 AMOLED over QSPI (four data lines) at 40 MHz, as Waveshare\'s demo runs it; like the CO5300 it speaks the SH8601 command set (Waveshare drives it with esp_lcd_sh8601). Init: sleep out (0x11, wait 120 ms), MADCTL 0x36 = 0xF0 for landscape, COLMOD 0x3A = 0x55 (RGB565), display on, brightness 0x51.',
    'Native 240×536 portrait; in landscape the window is CASET 0..535 (0x2A 0x0000..0x0217), RASET 0..239 (0x2B 0x0000..0x00EF), no offset.',
    'No backlight: brightness is command 0x51 (0..255). Black pixels are off. RGB565 pixels go out big-endian.',
    'A full RGB565 frame is 240 × 536 × 2 ≈ 251 KB: keep it in PSRAM. ESP32-S3R8: 8 MB octal PSRAM (board_build.arduino.memory_type = qio_opi), 16 MB flash.',
    'Native USB only: build with -DARDUINO_USB_MODE=1 -DARDUINO_USB_CDC_ON_BOOT=1 or serial stays silent; hold BOOT while pressing RESET if the port doesn\'t show up.',
    'One user key: BOOT on GPIO0 (active low), button A. The other key is RESET.',
    'QMI8658 IMU on I2C (SDA 40, SCL 39), interrupts on GPIO45 and GPIO46: Bench\'s `imu` module.',
    'The TF card shares the display\'s clock line (GPIO47); its CS is GPIO9, MOSI 42, MISO 8. Release the QSPI bus before talking to the card.',
    'Battery voltage on GPIO1 (ADC1 channel 0) through a divider.',
  ],
  url: 'https://docs.waveshare.com/ESP32-S3-AMOLED-1.91',
  enclosure: {
    // 24.5 × 57.5 mm, a Pico-style board under a 4 mm display module; the glass (19.8 × 44.22 mm)
    // sits 2.35 mm from the top edge. USB-C at the bottom, BOOT and RESET at the back's bottom corners.
    style: 'pcb',
    body: { w: 24.5, h: 57.5, d: 1.6, r: 1 },
    module: { w: 24.5, h: 57.5, d: 4, r: 1, x: 0, y: 0 },
    screen: { x: 0, y: 4.3 },
    parts: [
      { kind: 'port', face: 'bottom', u: 0, v: -1.6, w: 9, h: 3.2, label: 'USB-C' },
      { kind: 'button', face: 'back', u: 8.9, v: -24.3, w: 3.5, h: 3, input: 0, label: 'BOOT', color: '#d8d8d8' },
      { kind: 'button', face: 'back', u: -8.9, v: -24.3, w: 3.5, h: 3, label: 'RESET', color: '#d8d8d8' },
      { kind: 'header', face: 'back', u: -8.89, v: 2.4, pins: 20, along: 'v' },
      { kind: 'header', face: 'back', u: 8.89, v: 2.4, pins: 20, along: 'v' },
      { kind: 'port', face: 'back', u: 0, v: 4, w: 11, h: 10, label: 'TF card' },
      { kind: 'port', face: 'back', u: 0, v: -17, w: 6, h: 3, label: 'BAT' },
    ],
  },
  look: { activeWidthMm: 19.8, activeHeightMm: 44.22, cornerRadiusPx: 6 },
} satisfies DeviceProfile;
