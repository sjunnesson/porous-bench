import type { DeviceProfile } from './types';

// Scott Bezek's SmartKnob View (github.com/scottbez1/smartknob), on the ESP32-S3 base its firmware's
// `brushknight_esp32s3` build is for: pins from that build in platformio.ini (the base itself isn't
// published). The screen, knob, press and LEDs are the View's: a GC9A01 under the knob's glass,
// SPI at 40 MHz as TFT_eSPI is set up there; a gimbal motor (TMC6300 driver, MT6701 encoder) run by
// SimpleFOC; strain gauges on an HX711 for the press; eight SK6812-SIDE-A lighting a ring round the
// knob. The case and knob from the View's printed parts (mechanical release v185, measured off the
// STLs). Not measured on one: Bench has no firmware for it yet.
export default {
  id: 'smartknob-view',
  name: 'SmartKnob View',
  tech: 'lcd',
  shape: 'round',
  width: 240,
  height: 240,
  controller: 'GC9A01',
  bus: { kind: 'spi', hz: 40_000_000 },
  ram: { width: 240, height: 240, offsetX: 0, offsetY: 0 },
  // SK_DISPLAY_ROTATION 0: up is away from the USB-C.
  firmwareRotation: 0,
  // The knob is the only control: pressing it is button A.
  builtins: ['haptic'],
  // Side-firing, under the case's rim, so they light the gap between the knob (Ø51) and the case (Ø54).
  ring: { count: 8, radiusMm: 26.25 },
  boards: ['smartknob-view'],
  wiring: {
    'LCD MOSI': 3,
    'LCD SCLK': 4,
    'LCD CS': 9,
    'LCD DC': 2,
    'LCD RST': 6,
    Backlight: 5,
    'LED data (SK6812)': 7,
    'Motor UH': 20,
    'Motor UL': 19,
    'Motor VH': 21,
    'Motor VL': 17,
    'Motor WH': 12,
    'Motor WL': 18,
    'MT6701 data': 37,
    'MT6701 clock': 13,
    'MT6701 CSN': 14,
    'HX711 DO': 38,
    'HX711 SCK': 1,
    'I2C SDA': 15,
    'I2C SCL': 8,
  },
  porting: [
    'Pins from the SmartKnob firmware\'s brushknight_esp32s3 build (platformio.ini, Grigorii Merkushev\'s base, not published): the LCD on SPI (MOSI 3, SCLK 4, CS 9, DC 2, RST 6, no MISO), backlight PWM on 5, SK6812 data on 7, the TMC6300\'s six gate inputs UH 20, UL 19, VH 21, VL 17, WH 12, WL 18, the MT6701 over SSI (data 37, clock 13, CSN 14), the HX711 (DO 38, SCK 1), I2C on 15 / 8.',
    'GC9A01 round IPS LCD, 240×240, at 40 MHz as TFT_eSPI drives it there (GC9A01_DRIVER, CGRAM_OFFSET). Round glass: only the circle of radius 120 px round the centre shows. The LCD sits on the stationary shaft under the knob\'s 39.5 mm watch glass, so the picture doesn\'t turn with the knob.',
    'Backlight PWM at 12 bits at most: the ESP32-S3 claims 13 and panics past 12 (SK_BACKLIGHT_BIT_DEPTH=12).',
    'The knob: a gimbal BLDC (the View\'s 32 mm hollow-shaft motor with a diametric magnet) on a TMC6300, its angle from an MT6701 over SSI, driven by SimpleFOC in voltage mode. The SmartKnob runs that loop in a FreeRTOS task of its own, about once a millisecond (motor_task.cpp): keep Resident\'s Lua, Wi-Fi and the display off its core and never block it. It calibrates once (the zero electrical offset and direction, kept in flash).',
    'Detents as the SmartKnob makes them: a PID on the angle to the nearest detent\'s centre, P = 4 × the detent strength (the endstop strength past either end, none between magnetic detents), D scaled down for wide detents, no torque above 60 rad/s. The position moves on once the angle is snap × width past the centre. Expose its config (PB_SmartKnobConfig) as Bench\'s `haptic.config` and the position as `haptic` events.',
    'The press: strain gauges (SMD resistors on the base\'s flexure) on an HX711 (DO 38, SCK 1), calibrated for an idle value and a press delta kept in flash; the motor plays a strong click for each press. It\'s the board\'s only button: make it button A.',
    'LEDs: eight SK6812-SIDE-A on GPIO 7 (FastLED), from the top clockwise, lighting the gap round the knob. Drive them as Bench\'s `leds` module beside the screen. The View\'s base also has a VEML7700 light sensor on I2C for the backlight; this build turns it off (SK_ALS=0).',
    'Serial on UART through the board\'s USB-serial chip, not the S3\'s USB CDC (SK_FORCE_UART_STREAM=1).',
    'Memory: the S3 module isn\'t published. GPIO 37 carries the MT6701\'s data, so it can\'t be an octal-PSRAM module (those take 35–37): quad PSRAM or none. A full RGB565 frame is 240 × 240 × 2 = 112.5 KB; measure the free heap after Wi-Fi and TLS before giving apps a number.',
  ],
  url: 'https://github.com/scottbez1/smartknob',
  enclosure: {
    // The View's Enclosure: 85 × 85 mm, 9 mm deep, ~5 mm corners, with a Ø54 mm hole for the knob.
    // The Knob: Ø51 mm, standing 23 mm off the case, its glass Ø39.5 mm. USB-C at the bottom
    // (SK_DISPLAY_ROTATION 0), placement approximate.
    style: 'case',
    body: { w: 85, h: 85, d: 9, r: 5 },
    screen: { x: 0, y: 0 },
    knob: { r: 25.5, d: 23, glass: 19.75 },
    parts: [{ kind: 'port', face: 'bottom', u: 0, v: 0, w: 9, h: 3.2, label: 'USB-C' }],
  },
  // GC9A01 1.28": the active area is a Ø32.4 mm circle.
  look: { activeWidthMm: 32.4, activeHeightMm: 32.4, cornerRadiusPx: 120 },
} satisfies DeviceProfile;
