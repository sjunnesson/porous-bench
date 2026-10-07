# epd213: Resident on a Waveshare 2.13" e-Paper board

Resident firmware for the Waveshare ESP32 e-Paper Driver Board (ESP32-WROOM-32, 4 MB flash, no
PSRAM, CP2102, USB-C) with a 2.13" B/W e-paper panel, built in the three stages of Resident's
[start-building guide](https://github.com/inanimate-tech/resident/blob/main/docs/start-building.md).
Each stage is its own buildable PlatformIO project:

```
device-no-resident/       stage 1: chip info + test card, partial/full refresh check
device-minimal-resident/  stage 2: Wi-Fi (WiFiManager portal) + relay WebSocket + status screen
device/                   stage 3: drivers: screen, lgfx, button, screens (+ DEVICE-SKILL.md)
device-lvgl/              experiment: stage 3 + LVGL 9 (luavgl) + a heap probe (-DMEM_PROBE); doesn't fit
device-s3/                the same drivers + lvgl on an ESP32-S3 with PSRAM (see "Moving to an ESP32-S3")
```

Each project pulls Resident from GitHub, pinned to the commit it was built and tested against
(0.10.2, `ecabf22`), so nothing needs cloning. `device-lvgl/` and `device-s3/` share `device/`'s
drivers.

```bash
cd firmware/epd213/device && pio run -t upload && pio device monitor
```

On first boot without saved Wi-Fi the board opens a `Resident epd213 …` hotspot; join it and enter
your network. The panel then shows the 8-character device ID.

## Wiring (fixed on the driver board)

| Panel | GPIO |
|---|---|
| DIN (MOSI) | 14 |
| CLK | 13 |
| CS | 15 |
| DC | 27 |
| RST | 26 |
| BUSY (high = busy) | 25 |
| IO12 key (to GND) | 12, internal pull-up |

## Quirks worth knowing

- **The panel is a V2, not a V4.** The ribbon reads `HINK-E0213A22-A0` (2019): Waveshare's 2.13" V2,
  controller IL3897 / SSD1675A. Geometry and RAM layout match the V4 (122×250, 16-byte rows,
  bit = 1 white, window from x0/y0), and the SSD1680's full refresh (0x22 = 0xF7) happens to work,
  which hides it, but the V4's partial refresh runs the full 3 s flashing waveform, and SSD1680 LUT
  writes are ignored. `Epd213` loads Waveshare's V2 70-byte LUTs for both refreshes: full 1.85 s,
  partial 0.2 s.
- **IO12 needs the internal pull-up.** The key shorts IO12 to GND and the board has no pull-up
  (IO12 is a flash-voltage strap that must be low at reset), so it floats at 0 until `INPUT_PULLUP`.
- **Opening the serial port resets the board** (CP2102 auto-reset). Open it with DTR/RTS released,
  or the board stays held in reset.
- **Flips are asynchronous.** A Lua `flip()` only snapshots the 4 KB frame; the panel refreshes from
  the driver's `update()`, newest frame wins, identical frames are skipped, every 10th refresh is full.
  A synchronous 1.9 s full refresh inside a Lua dispatch would trip the sandbox's 1 s deadline.
- **`lgfx` draws straight into the 1-bit frame** (a custom `LgfxTarget`), not into a 61 KB RGB565
  sprite, so `screen` and `lgfx` share one buffer and that heap stays free for apps.
- **Memory is the limit.** `ESP.getFreeHeap()` reports ~140 KB once connected, but that counts IRAM
  only reachable with 32-bit access; Lua gets byte-addressable heap, and there is ~70 KB of it after
  Wi-Fi + TLS (TLS alone takes ~40 KB). An incoming app costs about twice its size while it is parsed,
  and compiling costs ~3.5-4x its source. Bench now minifies what it mirrors and sends only the
  shim parts an app uses; a load fits when ~6x its wrapped size stays under ~3/4 of the 70 KB
  (Bench's `src/resident/needs.ts` estimates exactly this). tilt-ball and lgfx hello fit; Bench's
  11 KB water-sim and 13 KB Hello display don't.
- **No `lvgl`.** `device-lvgl/` builds (2.35 MB) and `lv_init()` is cheap (2 KB), but the first
  `lvgl.bind` costs ~30 KB for good (luavgl's bindings, the display, its draw buffer), which leaves
  too little to compile and run Bench's LVGL apps over TLS. LVGL apps need a board with PSRAM.
- No timezone: the board runs on UTC.
- **While Bench mirrors, IO12 is ignored.** Bench's shim drops the board's own tap/hold events and
  replays the taps and holds Bench recognised on its buttons A and B, so both screens count the
  same. IO12 still works for apps pushed without Bench, and for the boot countdown.

## Moving to an ESP32-S3 (for LVGL apps)

`device-s3/` is `device/`'s drivers (shared through `symlink://../device/lib/drivers`, configured by
build flags in `BoardConfig.h`) plus `lvgl`, built for a board with PSRAM. Lua and LVGL then live in
8 MB of PSRAM, so Bench's LVGL apps (Hello display, characters, patterns, ...) have room.
**It compiles but hasn't run on hardware yet.**

### Parts

- **Espressif ESP32-S3-DevKitC-1-N16R8**: 16 MB flash, 8 MB octal PSRAM. (N8R8 works too; change
  the flash size and partitions in `platformio.ini`.) Clones of the same board are fine.
- **Waveshare 2.13" e-Paper HAT or Module, black/white**, any variant with the 8-pin header
  (VCC GND DIN CLK CS DC RST BUSY); it ships with the jumper cable. What's sold now is the **V4**
  (SSD1680), which is what `-DEPD_PANEL=4` drives. If yours has a 9th pin labelled PWR, tie it to 3V3.
- Optional: a push button between GPIO 4 and GND for key B. Key A is the board's BOOT button.

Reusing the panel from the driver board instead means peeling it off (it's taped down) and plugging
its ribbon into a Waveshare e-Paper Driver HAT, then building with `-DEPD_PANEL=2`.

### Wiring (all on the DevKitC-1's left header, J1; pins are labelled on the board)

| Panel | ESP32-S3 |
|---|---|
| VCC | 3V3 |
| GND | GND |
| DIN | GPIO 11 |
| CLK | GPIO 12 |
| CS | GPIO 10 |
| DC | GPIO 13 |
| RST | GPIO 14 |
| BUSY | GPIO 9 |
| key B (optional) | GPIO 4 to GND |

These avoid the S3's strapping pins (0, 3, 45, 46), the octal PSRAM (33-37), USB (19, 20) and the
UART (43, 44). Different pins: change the `-DEPD_*` flags.

### First flash

Plug USB into the port labelled **UART** (the USB-serial bridge; `Serial` goes there), then:

```bash
cd firmware/epd213/device-s3 && pio run -t upload && pio device monitor
```

It's a new chip, so it gets a new device ID and opens the `Resident epd213 …` hotspot for Wi-Fi.
Things to check first, in order: the boot banner reports 8192 KB of PSRAM; the status screen draws
the right way up; partial refreshes update in place (~0.3-0.5 s) instead of flashing the whole
panel (if they flash, the module is not a V4: try `-DEPD_PANEL=2`); BOOT taps arrive as `tap`
events; Hello display mirrors from Bench.
