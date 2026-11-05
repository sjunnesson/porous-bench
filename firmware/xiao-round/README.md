# Resident on the Seeed Studio Round Display for XIAO

Firmware that puts the Seeed Studio Round Display for XIAO, driven by a XIAO ESP32S3 plugged into
its back, on Resident's relay, so porous.systems Bench can mirror apps onto it. One PlatformIO
project per stage of Resident's start-building guide, each buildable on its own; Resident is pinned
by commit (0.12.0, `5ca238c`; stage 3 on Bench's fork at `59cd3cf`, which adds the tick interval, the event drain, and `lgfx`'s `pushImage` and clip rectangle), so nothing needs cloning.

```
device-no-resident/       stage 1: chip info, a test card, I2C scan, RTC, touch crosshair
device-minimal-resident/  stage 2: Wi-Fi portal, WebSocket to the relay, status and device ID
device/                   stage 3: the drivers; DEVICE-SKILL.md and check apps in device-apps/
```

Build and flash a stage with `pio run -t upload` in its folder. The XIAO shows up as a USB
Serial/JTAG port (`/dev/cu.usbmodem…`); if it doesn't, hold B (BOOT) while pressing R (reset).
**The display's power switch, on its rim, must be on**, even on USB (see below).

## What stage 3 gives apps

`screen` (M5Stick verbs), `lgfx` (LovyanGFX-style), `lvgl` (LVGL 9 via luavgl), `button` (the XIAO's
B key: `tap` / `hold`), `touchscreen` (CHSC6X: `read()`, `touch_*` events), `screens` (`"main"`:
240×240 round, 16-bit, dark, brightness). Lua and LVGL live in the 8 MB PSRAM. Bench's board entry
(`seeed-xiao-esp32s3-round-display`: screen, lgfx, lvgl, 8192 KB) matches: with an app running,
~8.2 MB of PSRAM and ~142 KB of internal RAM stay free (measured on core 3.3.12; ~163 KB on 2.0.17).

**Arduino core 3.3.12** (ESP-IDF 5.5, pioarduino `55.03.312`, pinned) since 2026-11-01, moved as
the S3-Touch-LCD-2 was (see its README: the backlight's `ledcAttach`, `esp_websocket_client`,
`lib_ignore = SD`, `../../core3.py`). Measured on the board against 2.0.17: LVGL's 48 px box 66 fps
at 0.8 ms a push, a full-frame push 18.9 ms (~17.5), static RAM 65,624 → 71,116 bytes, flash
2.48 → 2.71 MB; touch, B taps and holds and the backlight checked with `driver-check.lua`.

`lgfx` also has `pushImage`, plain (RGB565) or through a palette with a transparent index, and
`setClipRect` / `clearClipRect` (Resident's fork at `59cd3cf`, branch `lgfx-pushimage`; since
2026-11-01, as on the Guition 4848S040). The canvas writes both kinds of image straight into its
buffer, marking the tiles they cover, and clips everything drawn into it, `screen` included, until
the app clears the clip or the next app starts. The palette is made native once and kept until it
changes (1.5 KB of static RAM, as on the Guition). Flash 2,476,721 → 2,479,537 bytes, static RAM
64,056 → 65,624. Flashed and checked on the board 2026-11-01 with the S3-LCD-2's
`device-apps/image-check.lua` (it keeps inside the round glass), matching Bench: blocks, a palette
sprite's clear hole and corners, everything cut to the clip. A 240×20 push takes 0.22 ms, as on the S3. An app that left a clip set no longer cuts the next
app's black start (all black after one that filled white and left a 40×40 clip).

Brought up and tested on hardware 2026-10-12: device type `xiao-round`, firmware `xiao-round-0.1`.

## What bring-up taught

- **Chip:** ESP32-S3 (QFN56) rev v0.2, 8 MB embedded octal PSRAM (`qio_opi`), 8 MB flash, on
  Arduino core 3.3.12 (2.0.17 until 2026-11-01). PlatformIO's `seeed_xiao_esp32s3` board already sets
  the PSRAM and native-USB flags. `Serial.setTxTimeoutMs(0)`: plugged into a computer with no
  monitor open, a print would otherwise wait for room (up to 2 s on core 3.x).
- **The power switch cuts the display board's 3.3 V, USB or not.** With it off, the screen stays
  dark, and the I2C bus's pull-ups (on that 3.3 V) are unpowered: the first stage 1 hung in its I2C
  scan for over a minute. Every stage now gives Wire a 20 ms timeout, and stage 3's boot log says
  `NO ANSWER on I2C: is the display's power switch on?` when the RTC, which always answers, doesn't.
- **Panel:** Adafruit's GC9A01A driver as it is: `begin()` sends SWRESET (the LCD's reset is an RC on
  the board, not a pin), its init sequence (BGR) and INVON. Rotation 0 is up with the XIAO's USB-C on
  the right, as Seeed holds it; colours, the edge circle and orientation checked on a test card.
- **Stage 3 turns the picture 270°** (since 2026-10-27, `SCREEN_ROTATION` in `platformio.ini`,
  degrees clockwise, as on the Guition): up is away from a USB-C facing down. The GC9A01 turns it
  as it stores what it's sent (Adafruit's rotation 3, MADCTL MX MY MV), so the canvas and every push
  stay as they are, at no cost; `Lcd::toImage` turns the touch chip's points to match. Checked on
  the board: an arrow drawn pointing up points away from the USB-C, and a dot drawn at each touch
  sits under the finger. Stages 1 and 2 stay at 0.
- **SPI at 80 MHz** pushes a full frame in ~18 ms and looks identical on the glass to 40 MHz (31 ms).
  Seeed's setup asks for 50 MHz, which the S3 can't make and turns into 40.
- **The frame:** `screen`, `lgfx`, LVGL and the status text share one 240×240 RGB565 canvas
  (112.5 KB, in PSRAM). Flips push only the 16×16 tiles drawn on, LVGL's flushes only their
  rectangles, as in Bench's S3-Touch-LCD-2 firmware (`firmware/s3-lcd2`, whose drivers this is
  built from); lines and pixels go straight into the canvas.
- **Tiles, not rows; lines straight in** (since 2026-10-26, from the Guition's firmware). Each run of
  drawn tiles along a band of 16 rows goes to the panel through its own address window, in one SPI
  transaction, where the band of rows from the topmost drawn to the bottommost used to go out
  whole; lines no longer go through Adafruit GFX's two virtual calls a pixel. Measured here: Koi
  Pond's flips from 11.6 ms (158 rows, 66% of the frame) to 5.5 ms (29%), on the 33 ms tick
  either way; a 40 px diagonal from 24 us to 12, a 30 px circle from 60 to 30; a full-screen flip
  unchanged at ~17.5 ms. The `[perf]` line gives the share of the frame a push instead of rows.
- **Rectangles fill row by row** (since 2026-10-27, as on the C6). Adafruit GFX fills a rectangle
  a column at a time, each column through two virtual calls and its own tile marking, so wide,
  short ones cost most. Measured here: a 60×2 span from 42 us to 10 (2×60: 13 to 11), a 70×4 row
  54 to 14, a 60×40 block 130 to 57, a 70×16 rounded box 87 to 43, 200×200 4.0 ms to 2.5, the
  whole 240×240 5.6 ms to 3.3, as fast as `fillScreen` (writing the canvas in PSRAM is the limit).
- **LVGL refreshes every 15 ms, and fonts aren't compressed** (since 2026-10-23, `lv_conf.h`).
  `LV_DEF_REFR_PERIOD` was 33, which held LVGL to 30 frames a second however fast it drew. Resident
  runs LVGL's timers at most every 5 ms (`lv_timer_handler_run_in_period(5)`), so the period should
  be a multiple of 5: 16 only came due at 20 ms (50 fps), 15 gives up to ~66. `LV_USE_FONT_COMPRESSED` is off, so no glyph is decompressed as it's drawn; the
  one compressed built-in font, `MONTSERRAT_28_COMPRESSED`, is off with it (plain `MONTSERRAT_28`
  stays). Flash 2,501,589 → 2,474,741 bytes. Measured on the S3-Touch-LCD-2, which shares this
  `lv_conf.h` (small redraws 28.6 → 65.6 fps); not yet on this board: an LVGL app's `[perf]` line.
- **`on_tick` every 33 ms, not 100** (since 2026-10-23): `SandboxConfig::tickIntervalMs = 33`, a
  field on Bench's Resident fork (`sjunnesson/resident`, 0.12.0 plus the field) until
  inanimate-tech/resident takes it. Measured on the C6-LCD-1.47 (a 65 ms flame went from 10 to 15
  fps); not yet on this board. Bench's profile for the display ticks at 33 too (`tickMs`).
- **Backlight:** D6 (GPIO43) through a transistor, PWM at 10 kHz, 10-bit, with the KE switch's 2 on;
  with it off a pull-up keeps it at full. D6 is also UART0 TX, so the backlight flickers with the
  ROM's boot log at reset.
- **I2C (SDA D4 = GPIO5, SCL D5 = GPIO6, 100 kHz as Seeed runs it):** touch at 0x2E, the PCF8563 RTC
  at 0x51. The RTC's lost-power flag was set: there's no CR927 cell in its holder, and the firmware
  doesn't use it (the clock comes from NTP).
- **Touch (CHSC6X):** 5 bytes, no register: byte 0 is 1 while a finger is down, x in byte 2, y in
  byte 4 (byte 1's high bits: 0x00 down, 0x40 up, 0x80 contact), in the picture's own pixels (a
  crosshair drawn at the reported point sits under the finger). The chip doesn't answer while idle.
  While a finger is down, INT (D7, GPIO44) is a pulse train, ~72 falling edges a second, one per
  report, low most of the time with short high blips between them. The driver counts falling edges
  by interrupt and reads after one, while INT is low, or while a finger was down.
- **Touch stopped once.** With the first stage 3 (I2C at 400 kHz, reading only while a 10 ms poll
  saw INT low), touch died after an app was pushed while a finger was dragging, and stayed dead
  through an ESP32 reset; it came back under a build that also read the chip once a second
  regardless of INT, without a power cycle. The same push-while-dragging test with the edge latch
  and 100 kHz kept working. The cause isn't pinned down; `-DTOUCH_DEBUG` logs INT edges, polls that
  saw INT low and reads, once a second, should it happen again.
- **Opening the serial port resets the board** (`rst:0x15 USB_UART_CHIP_RESET`): reading the log
  restarts the app, which comes back from LittleFS after the boot countdown.
- **Saved apps** go to `/app.lua` on LittleFS (`AppStore.h`, as on the S3-Touch-LCD-2: NVS is too
  small for big apps). The first boot formats the partition and logs `Corrupted dir pair` and
  `mount failed` once before `[store] apps saved to LittleFS`.
- **Wi-Fi:** the portal is `Resident Xiao-round <id>`.
- **Device ID:** `6880f9a1` (from the MAC, E0:72:A1:F9:80:68).

## Speed and memory since 2026-11-05

The same changes as the Guition's, whose README says why each is there: LVGL's hot drawing code in IRAM
with only the colour formats in use, TLS in PSRAM (`TlsInPsram.h`), a floor under LVGL's use of
internal RAM (`LvglAlloc.c`), a 16 KB loop stack (`[perf]` reports what's left), `BootGuard.h`,
`LUAI_MAXCCALLS` 25 and `LV_INV_BUF_SIZE` 64. This board kept up before them, so they buy margin: Patterns' Rings 50 passes of
LVGL's timer a second to 54, Bars 56 to 57, Little devil 42 to 44, and Patterns at 33 frames a second
either way. Internal RAM free at boot went from 250 to 226 KB, and running the apps from 137 to 152 KB,
lowest 100 to 115 KB. The boot guard was tested with an app built to overflow the stack: "crash 2 in a
row: not loading the saved app", connected, and the next push ran and saved. After changing `lv_conf.h`,
delete LVGL's objects (`rm -rf .pio/build/xiao-round/lib*/lvgl`): PlatformIO doesn't see that it changed.

`LUAI_MAXCCALLS` was measured here: nested `pcall` panicked the board at ~30 levels on the 16 KB stack, and
with the limit it stops at 24 with `C stack overflow`, as does a recursive `__index`. All 19 bundled display
apps compile under it.

## Check apps (device/device-apps/)

- `driver-check.lua`: touch and its events (a crosshair, a ball chasing the finger), B taps and
  holds (a hold dims the backlight), the screen verbs, a ring at the edge of the glass.
- `lvgl-check.lua`: an LVGL arc that follows a finger round the dial, a sliding box, a label
  counting B taps.

Push one without Bench through the relay:

```sh
node -e 'fetch("https://resident.inanimate.tech/devices/<id>/send", { method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ channel: "system", type: "app", description: "driver-check",
    code: require("fs").readFileSync("device/device-apps/driver-check.lua", "utf8") }) })
  .then((r) => console.log(r.status))'
```
