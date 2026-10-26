# Resident on the Guition ESP32-S3-4848S040

Firmware that puts the Guition ESP32-S3-4848S040 (a 4" 480×480 touch panel for an 86 mm wall box,
with its own ESP32-S3) on Resident's relay, so porous.systems Bench can mirror apps onto it. One
PlatformIO project per stage of Resident's start-building guide, each buildable on its own; Resident
is pinned by commit (0.12.0, `5ca238c`; stage 3 on Bench's fork at `4220083`, which adds the tick interval and the event drain), so nothing needs cloning.

```
device-no-resident/       stage 1: chip info, the panel's scan rate, a test card, I2C scan, touch crosshair, a flash-write test
device-minimal-resident/  stage 2: Wi-Fi portal, WebSocket to the relay, status and device ID
device/                   stage 3: the drivers; DEVICE-SKILL.md and check apps in device-apps/
device/lib/panel/         the panel (ST7701S init, the RGB scan), shared by all three stages
```

Build and flash a stage with `pio run -t upload` in its folder. The USB-C goes through a CH340
USB-serial chip, so the board shows up as `/dev/cu.usbserial-…` or `/dev/cu.wchusbserial-…`, not as
a USB Serial/JTAG port, and auto-reset flashes it without touching a key (BOOT and RST are inside the
case). Give it a supply that holds 5 V: Wi-Fi's current spikes brown it out on a weak laptop port.
On the relay versions, don't feed 5 V into header H1 and the USB-C at the same time.

**Stage 3 has run on a board** (2026-10-26): "What bring-up found" says what that confirmed and
what it didn't. Stages 1 and 2 compile (espressif32@6.12.0, Arduino core 2.0.17) but haven't been
flashed.

## What stage 3 gives apps

`screen` (M5Stick verbs), `lgfx` (LovyanGFX-style), `lvgl` (LVGL 9 via luavgl), `touchscreen`
(GT911: `read()`, `touch_*` events), `button` (no keys: Bench's taps while it mirrors an app),
`screens` (`"main"`: 480×480, 16-bit, dark, brightness). Lua, LVGL and both frames (the canvas apps
draw in and the frame the panel is scanned from, 450 KB each) live in the 8 MB PSRAM. Bench's board
entry (`guition-esp32-s3-4848s040`: screen, lgfx, lvgl, 8192 KB) matches.

The picture is turned 270° (`SCREEN_ROTATION` in `platformio.ini`, degrees clockwise as ESPHome
counts them): up is away from a USB-C facing down. At 0 the USB-C is on the right. Apps see 480×480
either way, and touch turns with the picture.

The board has no key an app can use, so the touch panel is Resident's system button: during the
boot countdown, a touch anywhere loads the saved app now and a long one forgets it.

## How the panel works, and why the firmware is built this way

- **The ST7701S has no frame memory.** It takes an init sequence over 3-wire SPI (9-bit words,
  SCK 48, MOSI 47, CS 39; bit-banged, it's sent once), then shows whatever arrives on its 16-bit RGB
  bus (R 11 12 13 14 0, G 8 20 3 46 9 10, B 4 5 6 7 15; DE 18, HSYNC 16, VSYNC 17, PCLK 21). The
  init sequence is Arduino_GFX's `st7701_type9_init_operations`, which it labels as this board's,
  from the manufacturer: it sets 0xCD to 0x00 (without it red and blue keep 4 bits, the "MDT flag"
  ESPHome users found), leaves INVON off and runs the bus 18-bit (0x3A 0x60), 16 of it wired. There
  is no reset pin: a software reset (0x01) goes first.
- **The chip scans a frame out of PSRAM continuously.** IDF 4.4's `esp_lcd` RGB driver (the one in
  Arduino core 2.0.17) owns a 450 KB frame buffer in PSRAM and streams it at a 12 MHz pixel clock,
  with Arduino_GFX's porches for this init sequence (H 10/8/50, V 10/8/20): 548 × 518 clocks a
  frame, 42.3 frames a second. Pixels go out in RGB565 as the chip stores them; no byte swap.
- **Apps draw into a canvas of their own.** `screen`, `lgfx` and the status text draw into a second
  480×480 canvas; a flip copies what was drawn since the last one into the scanned frame. Drawing
  straight into the scanned frame would show every half-drawn frame. LVGL's flushes land in the
  canvas and its frame goes out whole when LVGL says it's done.
- **A flip copies 16×16 tiles, not rows** (since 2026-10-26, `Lcd::Canvas`). The canvas notes a bit
  for each tile anything is drawn on, and a flip copies the runs of drawn tiles along each band of
  16 rows as rectangles (`RgbPanel::drawRect`), then writes the cache back once. Copying every row
  from the topmost thing drawn to the bottommost, as it did, pushed most of the frame for five koi
  spread over the pond: 17-24 ms a flip; their tiles are ~20% of it, ~6.5 ms.
- **Lines and pixels go straight into the canvas.** Adafruit GFX draws a line pixel by pixel through
  two virtual calls and GFXcanvas16's checks, ~0.55 us a pixel on the board; `Canvas::drawLine` is
  its own Bresenham (a 40 px diagonal: 26 us down to 12), and `drawPixel`/`writePixel` write the
  buffer themselves, which circles and text go through (a 30 px circle: 65 us down to 40). A call
  from Lua costs ~3 us before it draws anything; `fillRect` ~0.05 us a pixel.
- **The picture is turned as it's copied.** With `SCREEN_ROTATION` set, `RgbPanel::drawRect` turns
  each rectangle into the scanned frame, and `RgbPanel::toImage` turns the GT911's points back, so
  no drawing path and no app needs to know. Turned 90° or 270°, a rectangle's canvas rows are frame
  columns: the CPU reads it along the canvas rows, 16 pixels (one 32-byte cache line) at a time, and
  writes it straight into the scanned frame, 16 frame rows at a time. IDF 4.4 has no call that
  returns the frame buffer (IDF 5 adds one), so `findFrameBuffer()` looks for the pointer among the
  driver's private fields: a PSRAM pointer under which two pixels drawn through `draw_bitmap` read
  back. If none does, turned rectangles go through a 15 KB strip in internal RAM and `draw_bitmap`.
  The canvas starts on a 64-byte boundary, so each 32-byte read is a single cache line.
- **PSRAM bandwidth is what a push costs.** Measured on the board (2026-10-26), a whole 480×480
  frame:

  | | ms |
  |---|---|
  | `draw_bitmap`, not turned (`memcpy` takes the same: PSRAM is the limit) | 26.2 |
  | reading 450 KB of PSRAM / writing 450 KB, through the cache | 11.1 / 16.9 |
  | turning 270° with the CPU, both sides in internal RAM | 5.0 |
  | turned 270° through a strip and `draw_bitmap`, canvas not aligned | 43.7 |
  | turned 270° through a strip, canvas aligned | 36 |
  | turned 270° straight into the frame (shipped) | 34 |

  In the apps, the same build turned and not (2026-10-26, two 30 s windows each):

  | | not turned | turned 270° |
  |---|---|---|
  | `driver-check`, the whole screen every tick | 19.1 fps (26.8 ms push, 52.3 ms a frame) | 16.8 fps (34.0 ms push, 59.5 ms a frame) |
  | `lvgl-check`, a sliding box (41-row bands) | 26.5 fps (2.4 ms a push) | 28.0 fps (4.1 ms a push) |

  The app's own drawing takes the same 25.5 ms either way: turning costs a full-screen app 7.2 ms a
  frame, 12%. An app that redraws a band stays under the 33 ms tick either way, and the tick sets
  its rate.

  With tiles and the faster lines (turned, 2026-10-26): `driver-check` 17.7 fps (every tile, 30.5
  ms a flip); `lvgl-check`'s box 2% of the frame, 0.4 ms a flip; Koi Pond (five koi drawn as lines,
  wiped by `fillRect`s) from ~22 fps to ~29, its flips 6.4-6.9 ms, so it keeps up with the tick.
- **Not by DMA.** GDMA (`esp_async_memcpy`, which IDF 4.4 lets write PSRAM) writes the frame past the
  cache, about twice as fast: 8.2 ms for a frame from internal RAM, 15.3 from the canvas, 19-21 ms
  turned with the CPU turning the next strip while the DMA writes the last. But it takes so much of
  PSRAM that the LCD's own DMA runs dry: the picture slipped again and again, several shifted copies
  ghosting across the glass, while the `[perf]` scan count stayed at 42.2. A slip doesn't show in
  the log; only on the glass.
- **Flash writes and the scan.** Writing flash stops the cache, and the PSRAM the scan reads from
  with it. On these RGB boards that is known to make the picture flicker or scroll (users of Tasmota
  and ESPHome report it during OTA and saves), and IDF 4.4 has no bounce buffers to carry the scan
  through it. On this board the picture glitches while flash is written and comes back by itself,
  in place: stage 1's FLASH wrote 256 KB seven times (0.8 to 2.5 s each) and the border was intact
  after every one. So an app save does nothing to the scan. Until 2026-10-26 stage 3 tore the scan
  down and started it again after each save, for a slip that never stays: a blink of black for
  nothing.
- **Touch: GT911 at 0x5D** on SDA 19, SCL 45 (a strapping pin), 400 kHz, pull-ups on the board. INT
  and RST aren't wired, so the address is whatever the board's straps make it and the chip is
  polled every 10 ms: status at 0x814E (bit 7: report ready, bits 0-3: fingers), the first finger
  at 0x8150, and 0 written back to hand the buffer over. A touch with no report for 200 ms counts as
  released.
- **Backlight:** PWM on GPIO38 at 20 kHz, 10-bit. ESPHome runs it at 150 Hz (others at 100 Hz),
  where it whines faintly when dim; at 20 kHz it's silent and fades as smoothly. It stays off until
  the panel has started, so the power-on noise never shows.
- **Chip:** ESP32-S3, 16 MB quad flash, 8 MB octal PSRAM (`qio_opi`). PlatformIO's
  `esp32-s3-devkitc-1` with the flash size and memory type overridden; Serial is UART0 through the
  CH340 (no `ARDUINO_USB_CDC_ON_BOOT`). The 16 MB holds one 4 MB app slot and ~12 MB of LittleFS.
- **Saved apps** go to `/app.lua` on LittleFS (`AppStore.h`, as on the S3-Touch-LCD-2: NVS is too
  small for big apps).
- **LVGL refreshes every 15 ms, and fonts aren't compressed** (since 2026-10-23, `lv_conf.h`).
  `LV_DEF_REFR_PERIOD` was 33, which held LVGL to 30 frames a second however fast it drew. Resident
  runs LVGL's timers at most every 5 ms (`lv_timer_handler_run_in_period(5)`), so the period should
  be a multiple of 5: 16 only came due at 20 ms (50 fps), 15 gives up to ~66. `LV_USE_FONT_COMPRESSED` is off, so no glyph is decompressed as it's drawn; the
  one compressed built-in font, `MONTSERRAT_28_COMPRESSED`, is off with it (plain `MONTSERRAT_28`
  stays). Flash 2,523,021 → 2,496,157 bytes. LVGL's frames still go out whole, and the panel
  scans at ~42 Hz, so ~66 is a ceiling it won't show; check the `[perf]` line with `lvgl-check.lua`.
- **`on_tick` every 33 ms, not 100** (since 2026-10-23): `SandboxConfig::tickIntervalMs = 33`, a
  field on Bench's Resident fork (`sjunnesson/resident`, 0.12.0 plus the field) until
  inanimate-tech/resident takes it. Measured on the C6-LCD-1.47 (a 65 ms flame went from 10 to 15
  fps). On this board `lvgl-check`, which moves its box in `on_tick`, pushes 28 frames a second:
  the tick is what holds it. Bench's profile for the display ticks at 33 too (`tickMs`).

## What bring-up found

The first board (2026-10-26) ran stage 3 with both check apps, not turned and then turned 270°,
and stage 1's card.

1. **The picture** fills the glass with Arduino_GFX's porches: `driver-check`'s border shows on all
   four edges. (Otherwise try ESPHome's H 8/10/20, V 8/10/10 in `RgbPanel.cpp`.)
2. **Orientation:** at 0, up has the USB-C on the right, as the sources say.
3. **Colours:** red, green and blue in order, not inverted, and stage 1's red and blue ramps as
   smooth as green's: no 4-bit banding, so 0xCD took.
4. **Touch:** the GT911 answers at 0x5D (product "911"), and the crosshair sits under the finger,
   not turned and turned.
5. **The scan** runs at 42.2 Hz (42.3 expected). A whole frame costs 26.2 ms to copy (more above).
6. **Flash writes** glitch the picture while they write, and it comes back by itself (above): no
   RESTART needed, so stage 3 no longer restarts the scan after a save.
7. **Backlight:** stage 1's fade from off to full is smooth, and so is dimming to 0.3 and back. At
   150 Hz, ESPHome's PWM, it whined faintly when dim; at 20 kHz it's silent and fades as smoothly,
   so the firmware runs it at 20 kHz.

Also from that board:

- The CH340 shows up as `/dev/cu.usbserial-10` (VID:PID 1A86:7523), and auto-reset flashes it with
  the case closed. A full flash backup (`esptool.py read_flash 0 0x1000000`) takes ~7 minutes at
  460800 baud.
- The factory firmware leaves its Wi-Fi in NVS, and WiFiManager tries that network before opening
  its portal: a board that was on Wi-Fi before comes up without the "Resident …" hotspot. Erase NVS
  (`esptool.py erase_region 0x9000 0x5000`) to get the portal.
- Memory, turned, with `driver-check` running: 164 KB of internal RAM free (151 KB in one block),
  7.4 MB of PSRAM.
- Stage 3 connects to the relay ~6 s after power-on, on a supply that held 5 V (no brownouts).

## Check apps (device/device-apps/)

- `driver-check.lua`: touch and its events (a crosshair, a ball chasing the finger), a DIM box to
  tap, the screen verbs, a border on the outermost pixels.
- `lvgl-check.lua`: an LVGL arc that follows a finger round the dial, a sliding box, a label
  counting touch taps.

Push one without Bench through the relay:

```sh
node -e 'fetch("https://resident.inanimate.tech/devices/<id>/send", { method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ channel: "system", type: "app", description: "driver-check",
    code: require("fs").readFileSync("device/device-apps/driver-check.lua", "utf8") }) })
  .then((r) => console.log(r.status))'
```

## Sources

- Pins and timing: ESPHome's device page for the Guition-ESP32-S3-4848S040 and its photo of the
  connectors; Arduino_GFX's `Arduino_GFX_dev_device.h` (`ESP32_4848S040_86BOX_GUITION`) and its init
  sequence.
- Touch: rzeldent's `esp32-4848S040CIY1.json` and Tasmota's autoconf (GT911 at 0x5D, INT and RST not
  connected).
- Flicker during flash writes: Michiel van der Wulp's notes on the board, the Tasmota discussion
  (#20527) and TNTLarsn's ESPHome config.
