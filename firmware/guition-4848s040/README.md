# Resident on the Guition ESP32-S3-4848S040

Firmware that puts the Guition ESP32-S3-4848S040 (a 4" 480×480 touch panel for an 86 mm wall box,
with its own ESP32-S3) on Resident's relay, so porous.systems Bench can mirror apps onto it. One
PlatformIO project per stage of Resident's start-building guide, each buildable on its own; Resident
is pinned by commit (0.12.0, `5ca238c`; stage 3 on Bench's fork at `59cd3cf`, which adds the tick interval, the event drain, and `lgfx`'s `pushImage` and clip rectangle), so nothing needs cloning.

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

Stage 3's first build compiles ESP-IDF to rebuild the Arduino core with its own settings (about
five minutes; see "Speed and memory"). It rebuilds the libraries inside the shared `~/.platformio`
framework package, so building another board's project afterwards reinstalls the prebuilt ones, and
the next build here compiles its own again. Build one project at a time.

Stage 3 connects to `resident.inanimate.tech`. For a self-hosted relay on the same wire (a
Cloudflare Worker), give its host at build time; a plain upload puts the board back on the hosted one:

```sh
PLATFORMIO_BUILD_FLAGS='-DRELAY_HOST=\"my-relay.example.workers.dev\"' pio run -t upload
```

The board trusts ISRG Root X1 and X2 and GTS Root R1 and R4 for the relay's certificate
(`src/RootCerts.h`). Courier on this core can't use IDF's certificate bundle and would trust GTS
Root R4 alone, and `workers.dev` serves a Let's Encrypt certificate: the handshake failed with
`-0x2700` (certificate not verified) until the ISRG roots went in.

**Stage 3 has run on a board** (2026-10-26): "What bring-up found" says what that confirmed and
what it didn't. Stages 1 and 2 compile (espressif32@6.12.0, Arduino core 2.0.17) but haven't been
flashed.

## What stage 3 gives apps

`screen` (M5Stick verbs), `lgfx` (LovyanGFX-style), `lvgl` (LVGL 9 via luavgl), `touchscreen`
(GT911: `read()`, `touch_*` events), `button` (no keys: Bench's taps while it mirrors an app),
`screens` (`"main"`: 480×480, 16-bit, dark, brightness). The 8 MB PSRAM holds the firmware's own
code (2.7 MB, copied there at boot), three 450 KB frames and Lua: about 3.9 MB is free with an app
running. Bench's board entry (`guition-esp32-s3-4848s040`: screen, lgfx, lvgl, 8192 KB) names the
chip's PSRAM, as for every board with PSRAM; no app comes near what's left.

`lgfx` also has `pushImage`, plain (RGB565) or through a palette with a transparent index, and
`setClipRect` / `clearClipRect` (Resident's fork, branch `lgfx-pushimage`). The canvas writes both
kinds of image straight into its buffer and clips everything drawn into it. Plenum's isometric
scenes draw each changed 16 px cell as the backdrop and the sprites over it, pushed through the
palette and clipped to the cell. Measured on the board with a full-screen harbour scene (~115 cells
a tick, its water cycling): 245 ms a tick when Lua composed the pixels and sent them as `fillRect`
runs, 34 ms with this (25-26 frames a second), and Lua's heap 1.2 MB instead of 3-5.
Since 2026-11-01 the black frame each app starts on is filled with the clip cleared: the screen
driver's reset runs before lgfx's (the order of `cfg.extensions`), so an app that left a clip set
had the next one start black only inside it. Flashed and checked 2026-11-01: after an app that filled
white and left a 40×40 clip, the next app's first flip was all black. The S3-LCD-2's
`device-apps/image-check.lua` draws as in Bench here too, and a 480×20 pushImage takes 0.77 ms
(~25 KB a millisecond into the PSRAM frame; the S3-LCD-2's internal-RAM canvas takes ~44).

Apps can be big: Plenum's are ~430 KB. ArduinoJson keeps a string's length in 2 bytes unless
told otherwise, so anything over 65,535 characters was dropped ("NoMemory") before it reached
Resident; `ARDUINOJSON_STRING_LENGTH_SIZE=4` in `platformio.ini` lifts that. Such an app also
takes longer than Resident's 1 s guard to run its top level (~3 s here, decoding its pictures), so
the guard is 8 s, and a dispatch over 100 ms is reported on serial and as `slow_dispatch`.

The picture is turned 270° (`SCREEN_ROTATION` in `platformio.ini`, degrees clockwise as ESPHome
counts them): up is away from a USB-C facing down. At 0 the USB-C is on the right. Apps see 480×480
either way, and touch turns with the picture.

The board has no key an app can use, so the touch panel is Resident's system button: during the
boot countdown, a touch anywhere loads the saved app now and a long one forgets it.

## How the panel works, and why the firmware is built this way

- **Stage 3 runs Arduino core 4.0.0-RC1 (ESP-IDF 6.1), with bounce buffers** (since 2026-11-02;
  2.0.17 before). The other colour boards moved to core 3.3.12 (IDF 5.5), and on it this panel didn't
  hold: scanned straight from PSRAM, as on 2.0.17, the picture jumped about whenever PSRAM was busy
  (IDF 5's driver loops the DMA and restarts it at each vertical sync, where 4.4's restarted it every
  frame anyway); with bounce buffers (the scan reads two 10-row buffers in internal RAM, refilled by
  an interrupt) the text at the top garbled and a white edge showed at the left and bottom now and
  then. That is esp-idf#19070: in bounce-buffer mode with `CONFIG_LCD_RGB_RESTART_IN_VSYNC` (on in
  Arduino's build) one late interrupt leaves the refill out of step with the scan. Fixed in IDF 6.0
  and 6.1, not 5.5, so core 4.0.0-RC1, whose IDF build has the fix: no glitch in several minutes of
  the full-screen `driver-check`. (Only half fixed with that option on, it turned out: see "A late
  refill" below.) Bounce buffers cost 19 KB of internal RAM and the CPU that refills
  them: `driver-check` 15 fps (34.5 ms a push), against 17.7 fps (30.5) on 2.0.17; 127 KB of internal
  RAM free with it running. On 4.0 it also needed QRCode's C compiled as C17 (C23 makes `bool` a
  keyword) and LVGL's ARM assembly left out (`../../core3.py`), and the panel's pins typed
  `gpio_num_t`. The panel driver builds on 4.4, 5 and 6 (`ESP_IDF_VERSION_MAJOR`): stages 1-2 are on
  2.0.17. Move to 4.0.0 when it's released.

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
- **A late refill, and how it looks.** The scan reads two buffers of 10 frame rows in turn, and an
  interrupt refills the one just sent, so it can wait ~450 us at most (10 rows at 45.7 us, less the
  copy). With the picture turned 270°, a frame row is a picture column, scanned from the right of the
  picture to the left, and each from the top down. So on the glass:
  - *A jump (one frame):* the same 20 columns repeat while the interrupt is held off, so a shape smears
    into a run of copies across the screen, and the rest of the frame is displaced. Captured on video:
    the right arrow eight times over.
  - *Shifted and ticked (lasting):* the whole picture 10 px to the right, and in every 10th column the
    first ~60 px from the top show what's 20 columns to the right: thin ticks beside anything curved
    near the top, half-lit dots. IDF 6.1's driver chooses the buffer to refill from a count of buffers
    sent, and with `CONFIG_LCD_RGB_RESTART_IN_VSYNC` on (Arduino's default) it never sets that count
    back to 0. A frame that loses an odd number of refills leaves it odd, and every refill after that
    goes into the buffer being sent, racing the scan, until another such frame turns it even. So a
    board was shifted for about half of each stretch between hiccups. The option is off here
    (`platformio.ini`): the driver then restarts the scan only after a frame that lost a refill, and
    sets the count back at each vertical sync. On the board (2026-11-06), three deliberate 9 ms hold-offs
    each came back within two frames.
  - *What held it off:* the heartbeat. `heap_caps_get_largest_free_block` walks the whole heap with
    interrupts off, and an app's Lua leaves a great many blocks in PSRAM: 4.4 to 9.5 ms with an app
    of 2-3 MB running, every 30 s, and nothing else over 1.8 ms in 5 minutes. The heartbeat
    now prints only the totals the heap keeps. Don't walk a heap (`heap_caps_get_largest_free_block`,
    `heap_caps_get_info`, `heap_caps_check_integrity`) while an app runs on this board.

  A profile build's `[gap]` lines catch these (`Profiler.h`): any time the app's core took no interrupt
  for over 1.8 ms, with where it was when they came back, and `[scan]` lines for each frame that lost
  refills. Send `x` to hold interrupts off for 9 ms on purpose.
- **Three frames, and apps draw straight into one that isn't on the glass** (since 2026-11-06,
  `Lcd::Canvas`). The driver keeps three frame buffers (`num_fbs = 3`). `screen`, `lgfx`, LVGL's
  flushes and the status text all draw into one that is neither being scanned nor about to be, and a
  flip names it to the driver (`esp_lcd_panel_draw_bitmap` with a pointer into its own frame), which
  scans it from the next vertical sync. Nothing is copied, the glass never shows a half-drawn frame,
  and no frame is shown torn. `on_frame_buf_complete` says when the refill interrupt has left a
  frame, so it's free again. Two frames would do, but the one just swapped out stays on the glass
  until the vertical sync, up to 24 ms in which nothing could be drawn: 5 ms a frame for Patterns,
  measured. The third costs 450 KB of PSRAM.
- **Tiles say what a frame lacks.** A frame taken up for the next picture is two pictures old. Each
  16×16 tile drawn on is noted, and at the flip those are tiles the other two frames now lack. A
  lacking tile is copied from the newest frame just before something is drawn on part of it, or at
  the flip if nothing was; one about to be covered whole (a clear, a big rectangle, an image, the
  middle of an LVGL flush) isn't copied at all. An app that redraws everything copies nothing; one
  that moves a sprite copies the tiles round it, a few hundred bytes each.
- **The picture is drawn turned.** With `SCREEN_ROTATION` set, every pixel, rectangle, line and
  image goes into the frame where the turn puts it (`Canvas::toFrame`), and `RgbPanel::toImage`
  turns the GT911's points back, so no app needs to know. Turned 90° or 270°, a picture row is a
  frame column: images and LVGL's flushes are written 16 frame rows at a time, reading the source
  along its rows 16 pixels at a time, so both stay in the cache.
- **Checked by hash, not by eye.** `Profiler.h`'s `h` prints a hash of the picture, in the picture's
  own coordinates, after each flip. Two test apps (16 scenes through `screen` and `lgfx`: fills,
  lines in every direction, text, circles, both kinds of image, a clip, partial redraws; 9 LVGL
  scenes) gave the same hashes drawn this way as through the canvas it replaced. What the hash can't
  see is the scan itself: look at the glass after changing `RgbPanel` or `Lcd`.
- **Lines and pixels go straight into the frame.** Adafruit GFX draws a line pixel by pixel through
  two virtual calls and GFXcanvas16's checks, ~0.55 us a pixel on the board; `Canvas::drawLine` is
  its own Bresenham, touching only the tiles it crosses, and `drawPixel`/`writePixel` write the
  frame themselves, which circles and text go through. Rectangles fill a frame row at a time
  (Adafruit fills a column at a time, each through two virtual calls).
- **What it replaced: a canvas, copied into the one scanned frame at each flip** (2026-10-26 to
  2026-11-05). Apps drew into a 450 KB canvas, and a flip copied the 16×16 tiles drawn on into the
  frame, turning them on the way. PSRAM's bandwidth set the price: a whole frame took 26.2 ms to
  copy and 30.5-34.5 ms turned, however it was done (through a strip in internal RAM: 36; reading
  450 KB of PSRAM alone: 11.1; writing it: 16.9). A full-screen app paid for the picture three times
  over: drawn into the canvas, read back out, written into the frame. A profile of `driver-check`
  had 52% of the app's core in that copy and 32% clearing the canvas; Little devil, hopping, 44% in
  the copy chain; an untuned LVGL screen 29%. `driver-check` ran at 15 fps and now runs at 30.
- **Not by DMA.** GDMA (`esp_async_memcpy`, which IDF 4.4 lets write PSRAM) writes the frame past the
  cache, about twice as fast: 8.2 ms for a frame from internal RAM, 15.3 from the canvas, 19-21 ms
  turned with the CPU turning the next strip while the DMA writes the last. But it takes so much of
  PSRAM that the LCD's own DMA runs dry: the picture slipped again and again, several shifted copies
  ghosting across the glass, while the `[perf]` scan count stayed at 42.2. A slip doesn't show in
  the log; only on the glass.
- **Flash writes and the scan** (as seen on 2.0.17; not looked at again since the code moved to
  PSRAM, which keeps the cache running through a flash write). Writing flash stops the cache, and
  the PSRAM the scan reads from with it. On these RGB boards that is known to make the picture flicker or scroll (users of Tasmota
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

## Speed and memory

Measured on a second board (`240a901b`, 2026-11-06), the same apps before and after, in passes of
LVGL's timer a second for LVGL apps (capped at 66; the apps draw at most 33 frames a second) and
frames a second for the rest (the tick is 30). "Untuned" is Patterns as it was before it was
rewritten for a board, and Rainbow as Resident ships it: apps nobody has tuned.

| | 2026-11-05 | own heap | code in PSRAM | three frames | bigger caches |
|---|---|---|---|---|---|
| Patterns: Orbits | 41.8 | 50.5 | 60.2 | 61.0 | 62.4 |
| Patterns: Bars | 33.2 | 33.1 | 49.1 | 48.0 | 55.6 |
| Untuned Orbits | 10.1 | 19.1 | 23.4 | 23.7 | 29.3 |
| Untuned Bars | 12.1 | 12.5 | 15.1 | 16.4 | 22.0 |
| Little devil, hopping | 7.1 | 7.2 | 8.8 | 10.2 | 12.7 |
| Untuned Rainbow (every pixel, in 4 px strips) | 8.4 | 8.5 | 8.7 | 20.0 | 30.3 |
| `driver-check` (the whole screen every tick) | 15.2 | 15.0 | 15.5 | 30.3 | 30.3 |

Each column adds to the one before. As shipped, over the relay: Patterns 57-62 on every screen (a
second visit to Orbits the same as the first), untuned Orbits / Rings / Bars / Spinner 29 / 10.5 /
22 / 14.5, Little devil 60 at rest and 13.7 hopping, Koi Pond, Birdie, Water Sim and the logo at
the tick's 30. One LVGL `set` costs 109 us where it cost 278 (a new table each call: 189, was 739).

Internal RAM free went from 229 KB at boot to 202, and from ~110 KB with Patterns running to ~75
(lowest 66). With an LVGL app at 62 KB free, Wi-Fi was dropped three times and the relay's
connection came back each time.

- **Profile first.** Build with `PLATFORMIO_BUILD_FLAGS=-DBENCH_PROFILE` and `Profiler.h` samples
  where the app's core is, 1000 times a second with two callers; `../prof.py firmware.elf log`
  names the addresses. The same build takes an app over serial (`L<bytes>`, no Wi-Fi needed),
  prints the picture's hash after each flip (`h`) and drops Wi-Fi on request (`k`). Every change
  below came out of a profile, and two guesses didn't survive one: the panel's refill interrupt
  takes 6% of the core, not the third of it the arithmetic suggested, and the time in the ROM was
  a lock, not `memcpy`.
- **LVGL's memory in pools of its own** (`LvglAlloc.c`). LVGL allocates two blocks for every shape
  it draws. Through the system heap each took the heap's lock with interrupts off: Patterns had the
  core waiting on it 7.5% of the time. 32 KB chunks of internal RAM, each a heap with no lock
  (`multi_heap_register`), taken only once an app uses LVGL and only above a floor of 48 KB free;
  past that, PSRAM. luavgl's `lvgl.Font()` frees an `lv_strdup` with `free()`, which then lands in
  the wrong heap and crashes the board in LVGL's styles: `../../core3.py` compiles luavgl's `free`
  as `lv_free`, which takes either kind of block.
- **A rebuilt core: code in PSRAM, bigger caches** (`custom_sdkconfig` in `platformio.ini`, ~5
  minutes the first build). The octal PSRAM answers a cache miss faster than the quad flash, and the
  profiles had 76-88% of LVGL's time in code read from flash: `CONFIG_SPIRAM_XIP_FROM_PSRAM` costs
  2.7 MB of PSRAM and no internal RAM. The scan alone pulls 19 MB a second of frame through the data
  cache: 64 KB with 64-byte lines (32 KB of internal RAM) is what took strided full-screen fills
  from 20 fps to 30, and a 32 KB instruction cache (16 KB) gives LVGL screens 16-23%.
- **LVGL's hot code is no longer in IRAM** (`LV_ATTRIBUTE_FAST_MEM`). While code ran from flash it
  was worth 20-45% and cost 25 KB; since, the benchmark set is within 1% with or without.
- **Nothing is written back from the cache after a flip.** With bounce buffers the refill
  interrupt reads the frame with the CPU, through the same cache it was written through. Writing
  back walked every cache line between the first and last row drawn, on every flip.
- **A 32-row draw buffer for LVGL** (was 40): a whole number of 16-pixel tiles, so a strip of a full
  repaint never leaves a tile half drawn to be copied first, as a third of them were. 48 rows were
  6-8% faster for screens of arcs and cost 15 KB of internal RAM more.
- **Only the colour formats in use** (`LV_DRAW_SW_SUPPORT_*`: RGB565 for the screen, ARGB8888 for
  LVGL's layers, A8 for fonts): 38 KB of code nothing reaches. luavgl's images take a file path, and
  every filesystem driver is off.
- **TLS in PSRAM** (`TlsInPsram.h`). The prebuilt core has mbedTLS allocate from internal RAM, about
  40 KB for a session. `mbedtls_platform_set_calloc_free` moves it at run time. With too little
  internal RAM a board can't connect at all (`mbedtls_ssl_setup returned -0x008D` at 57 KB free,
  largest block 31 KB, before this) and stays off the relay.
- **A 16 KB loop stack.** LVGL draws on Arduino's loop task, which has 8 KB. Patterns' old Tiles (72
  objects with `transform_scale`) needed 8.3 KB and rebooted the board; `[perf]` reports what's
  left. Layers nested inside layers can still overflow it, which is what `BootGuard.h` is for.
- **`BootGuard.h`.** Two crashes in a row, each within a minute of booting, and the next boot leaves the
  saved app out: "Saved app crashed" on the idle screen, connected, and a new push runs as usual.
- **`LUAI_MAXCCALLS` 25.** Lua allows 200 nested C calls: a recursive `pcall` or `__index` overflowed even
  the 16 KB stack at ~30 levels and panicked the board. Now the app gets a Lua error, `C stack overflow`.
  Every bundled app and everything in `my-apps` compiles under 25; 24 levels of `pcall` left 2.5 KB
  of the stack.
- **`LV_INV_BUF_SIZE` 64.** Past that many changed areas in a frame LVGL repaints the whole screen.
- **What's left** is LVGL's own drawing. A profile of the untuned Rings (five full-circle arcs turned by
  `rotation`, 11 fps): 17% blending, 12% arc masks, 25% writing its strips into the frame, 12% copying
  tiles its strips left half drawn (where an area doesn't start on a tile), 7% Resident's flush
  swapping bytes that are swapped back as they're written.
- **Not tried:** the refill interrupt on the other core (6% of this one, and Wi-Fi shares that one),
  PSRAM at 120 MHz (half as much bandwidth again; the timing is tuned for one temperature), IDF itself
  at `-O2`.
- **No longer seen:** Orbits' guide lines taking twice as long after some garbage collections
  (2026-11-05). It went with the code out of flash and the bigger caches, so a cache it was; which
  part of it wasn't isolated.
- **After changing `lv_conf.h`, delete LVGL's objects** (`rm -rf .pio/build/guition-4848/lib*/lvgl`).
  LVGL includes it through a macro, which PlatformIO's dependency scan doesn't follow: it says SUCCESS
  and flashes the old LVGL. A real build of LVGL shows as a minute more.
- **The 2026-11-05 round** (the first board, `107497c7`): IRAM for LVGL's blending (Rings 32 passes a
  second to 38-47), the colour formats, TLS in PSRAM, a floor under LVGL's internal RAM, the stack, the
  guard and the two limits. A bigger circle cache changed nothing, and an 80-row draw buffer gave 8%
  for 25 KB.

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
