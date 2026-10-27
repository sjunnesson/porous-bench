# c6-lcd147: Resident on a Waveshare ESP32-C6-LCD-1.47

Resident firmware for the Waveshare ESP32-C6-LCD-1.47 (ESP32-C6FH8: 8 MB flash in the package, no
PSRAM, native USB-C; 1.47" ST7789V3 IPS LCD, 172×320), built in the three stages of Resident's
[start-building guide](https://github.com/inanimate-tech/resident/blob/main/docs/start-building.md).
Each stage is its own buildable PlatformIO project:

```
device-no-resident/       stage 1: chip info, test card, full-frame push timing, RGB LED, BOOT
device-minimal-resident/  stage 2: Wi-Fi (WiFiManager portal) + relay WebSocket + status screen
device/                   stage 3: drivers: screen, lgfx, button, screens (+ DEVICE-SKILL.md),
                          on a rebuilt Arduino core with more RAM for apps (84 KB)
device-prebuilt-core/     the same firmware on the prebuilt core: quick to build, 59 KB for apps
core3.py                  build fixes for Resident's libraries on Arduino core 3.x (stages 2-3),
                          and device/'s -O2
```

The projects pull Resident from GitHub, pinned to the commit they were built and tested against
(0.12.0, `5ca238c`; stage 3 on Bench's fork at `4220083`, which adds the tick interval and the event drain), so nothing needs cloning.

```bash
cd firmware/c6-lcd147/device && pio run -t upload && pio device monitor
```

`device/`'s first build downloads and compiles ESP-IDF to rebuild the core (several minutes; see
"Memory"). It rebuilds the libraries inside the shared `~/.platformio` framework package, so building
a project on the prebuilt core afterwards (stages 1-2, `device-prebuilt-core/`) reinstalls those,
and the next `device/` build compiles its own again.

The rebuild ends by running `pio run` again from pioarduino's own Python environment
(`~/.platformio/penv`), which installs pioarduino's PlatformIO Core as 6.2.0.post1. Its platform
(55.03.312) asks for Core >=6.2.0, and semver reads `.post1` as a pre-release of 6.2.0: that second
run stops with `IncompatiblePlatform` and uninstalls the platform. Pin the penv to 6.2.0 once and
the rebuild runs through (2026-10-26):

```bash
~/.platformio/penv/bin/uv pip install pioarduino==6.2.0 --python ~/.platformio/penv/bin/python
```

On first boot without saved Wi-Fi the board opens a `Resident C6-lcd147 …` hotspot; join it and
enter your network. The screen then shows the 8-character device ID.

## Wiring (fixed on the board)

| Part | GPIO |
|---|---|
| LCD MOSI / SCLK | 6 / 7 |
| LCD CS / DC / RST | 14 / 15 / 21 |
| Backlight (PWM) | 22 |
| TF card MISO / CS (same SPI bus) | 5 / 4 |
| RGB LED | 8 |
| BOOT key (to GND) | 9 |

## Quirks worth knowing

- **`pio run -t upload` puts otadata's `boot_app0` at 0x19000**, where this partition table has it
  (`board_upload.arduino.boot_app0`, since 2026-10-27). Core 3.x writes it at 0xe000 unless told,
  which here is the middle of NVS: an upload before then overwrote two of its 16 pages. NVS reads
  them as corrupt and reclaims them, so what was on them is gone (on 2026-10-27 only superseded
  entries; Wi-Fi and the saved app were on other pages). The other boards keep otadata at 0xe000.
- **It's an ESP32-C6FH8, 8 MB of flash** (esptool: "ESP32-C6FH8 (QFN32) (revision v0.2)"), not the
  4 MB FH4 some listings show. The `esp32-c6-devkitc-1` board profile (8 MB) fits as it is.
- **Arduino core 3.x only.** The C6 needs pioarduino's platform; Resident's examples use
  `espressif32@6.x` (core 2.x). Three things in Resident's libraries need help there, all in
  `core3.py` and the `lib_deps`:
  - Courier's WebSocket client, `esp_websocket_client`, was part of ESP-IDF 4 and is a managed
    component since IDF 5, which the core's prebuilt libraries don't include. The projects take it
    from Espressif's component registry (1.8.0); `tcp_transport`, `http_parser` and `esp-tls`,
    which it needs, are in the core.
  - Esp32Lua's C++ wrapper (unused by Resident, compiled anyway) names `std::string` without
    including `<string>`; core 2.x headers pulled it in by accident. `core3.py` force-includes it
    for Esp32Lua's C++ files only (globally, it breaks OpenThread when `device/` compiles
    ESP-IDF).
  - Esp32Lua also carries Lua's standalone `lua.c` and `luac.c`, each with a `main()`. Core 2.x
    linked libraries as archives, so nothing pulled them in; pioarduino links library objects
    directly and the two collide. `core3.py` leaves them out of the build.
  - Core 3.x already compiles C++ as gnu++2b, so Resident's `-std=gnu++17` override isn't needed.
- **Panel:** Adafruit's ST7789 driver at `init(172, 320)` puts the columns at offset 34 and sends
  INVON. Its rotation 2 is the panel's native scan (MADCTL 0x00, as Waveshare's demo): top away from
  the USB-C port. Rotation 0 mirrors both axes.
- **One frame; a flip pushes the tiles drawn on.** `screen`, `lgfx` and the status text share one
  172×320 RGB565 canvas (110 KB), allocated before Wi-Fi so it gets one contiguous block. A full
  push at 80 MHz takes ~31-33 ms, inside the Lua dispatch (well under the 1 s deadline). There's
  no room for a second buffer to push from in the background, so since 2026-10-23 a `flip()` pushes
  only what was drawn since the last one: then the band of rows from the topmost drawn to the
  bottommost (a 40 px box erased and redrawn each tick: a tick from 32.1 to 4.0 ms, 40 rows in 3.9
  ms), since 2026-10-26 the 16×16 tiles drawn on (the last column is 12 px), each run of them along
  a band of 16 rows through its own address window in one SPI transaction, as the Guition's and
  S3-Touch-LCD-2's firmware do. Lines and pixels go straight into the canvas too, not through Adafruit
  GFX's two virtual calls a pixel. Measured against the rows: five boxes bouncing round the screen
  (each wiped with `fillRect` and redrawn) went from 19-23 ms pushes (197-239 rows) to 4.5 ms (13% of
  the frame); a 40 px diagonal from 28 us to 12, a 30 px circle from 60 to 40; `flame-c6`, which
  draws whole rows, unchanged at ~30.5 ms. The `[perf]` line every 30 s gives pushes a second, the
  share of the frame a push, ms a push and loop time.
- **Rectangles fill row by row** (since 2026-10-27, as on the other colour boards). Adafruit GFX
  fills a rectangle a column at a time, each column through two virtual calls and its own tile
  marking, so wide, short ones cost most. Measured here: a 60×2 flame span from 50 us to 10 (the
  same pixels as 2×60 took 14), a 70×4 candle row 64 to 14, a 70×16 rounded box 113 to 57, the
  full 172×320 clear 3.0 ms to 1.4.
- **Built with `-O2`, not `-Os`** (since 2026-10-23), as the S3-Touch-LCD-2 is, for Lua and the
  drivers: flash went from 1,733,642 to 1,854,720 bytes (of the 4 MB app slot); static RAM 63,860 →
  63,884 bytes. ESP-IDF's own optimisation (`CONFIG_COMPILER_OPTIMIZATION_PERF`) stays off: it
  would grow the IDF code in IRAM, which on the C6 is heap (see "Memory"). Measured on the board:
  the Lua arena still has 83,856 bytes free for apps and the shared heap ~49 KB, as before. The
  flame, which redraws every row each tick, went from 66-70 to 62-66 ms a tick (a full push 32 →
  30.6 ms, its Lua and drawing ~36 → ~34.5): a few per cent, not the S3's 15%. `core3.py` puts the
  `-O2` (`custom_optimize` in `device/platformio.ini`) on each file of the firmware, its libraries
  and the Arduino core, after the core's `-Os`. In `build_flags` it broke the next core rebuild
  (2026-10-26): ESP-IDF's newlib compiles `memcpy.c` and its kin with an `-O2` of their own and
  stops on `-Os` (`#error ... DIG-694`), and pioarduino adds a file's flag only if the environment
  doesn't have it yet, so with the project's `-O2` there those files kept the core's `-Os` after it.
- **`on_tick` every 33 ms, not 100** (since 2026-10-23). Resident ticked every app at a fixed 10
  fps; the firmware now sets `SandboxConfig::tickIntervalMs = 33`, a field on Bench's Resident fork
  (`sjunnesson/resident`, 0.12.0 plus the field) until inanimate-tech/resident takes it. Measured:
  the flame, whose tick takes ~65 ms, went from 10 to 15.2 fps, a tick every 66 ms rather than
  every 100; an app whose tick is short gets ~30. Apps get the real gap as `dt_ms`, so one that
  moves by it runs at the same speed. Bench's profile for the display ticks at 33 too (`tickMs`).
  With ticks back to back, Resident delivered one event per loop pass, a tick apart: a steady
  stream of 180 relay events at ~24/s to an app with 65 ms ticks lost 30% (125-129 arrived),
  against 1-6% at 100 ms. The fork also delivers every queued event each pass: 169-178 arrived.
  A burst bigger than Courier's and Resident's queues (8 and 7) within one tick still loses the
  rest at any tick rate: 10-19 of 40 sent at once.
- **Lua is slow: the C6 has no FPU.** Floats, `math.sin`, `math.sqrt` and `^` are emulated. A
  full-screen `lgfx` flame doing ~137,000 Lua instructions and 985 draw calls a tick took ~285 ms
  (3.5 fps, `dt_ms` averaged over 30 ticks); with lookup tables, integer colour blends and fewer
  calls (~50,000 instructions, 609 calls) it took ~104 ms (10 fps). Bench doesn't model this; the
  device skill's *Speed on a real board* section tells app writers how to stay inside a tick.
- **The RGB LED takes R, G, B** byte order, not a WS2812's G, R, B: `rgbLedWrite(8, r, g, b)` shows
  red as green. Stage 1 swaps them. No Lua module drives it.
- **BOOT is GPIO9**, active low, with the board's own pull-up (a strapping pin). It's the only key.
- **Opening the serial port can reset the chip.** The C6's USB Serial/JTAG resets on DTR low with
  RTS high, and a tool that drops DTR before RTS (pyserial does) passes through that state. Release
  RTS first, then DTR.
- **No coredump partition**, so `esp_core_dump_flash: No core dump partition found!` at boot is
  expected.
- **Local time is UTC until Bench mirrors here.** Before each app it mirrors, Bench sends the zone
  its own apps run in (`{channel: "bench", type: "timezone", data: {tz}}`), and the board applies it
  with `setTimezone` (one lookup through ezTime's server, up to 2 s; the same zone again is skipped,
  and a reboot forgets it). Not as a Resident `hello`, which would set the zone too but also make the
  board drop un-channelled messages until reboot, and `/resident:push-app` still sends those.

## Memory

Without PSRAM, Lua, Wi-Fi, TLS and the WebSocket share the C6's internal SRAM. All figures from
`heap_caps_get_free_size(MALLOC_CAP_8BIT)` and `heap_caps_get_largest_free_block`, on the board.

### Lua gets its own heap

Resident's Lua allocator takes whatever internal RAM is free, and on this board that broke the
connection two ways. A big mirrored app (porous systems) took the heap to ~1 KB, TLS couldn't
allocate, and the WebSocket dropped. Capping Lua's share of free bytes wasn't enough either: a test
app holding thousands of 1 KB strings left ~50 KB free but a 1.3 KB largest block, so TLS (which
needs 16 KB in one piece for a reconnect) still failed. Either way the board stayed off the relay and
couldn't be sent the next app.

So `LuaArena` (in `device/lib/drivers/`) takes one block at boot, before Wi-Fi, makes it a heap of
its own (`multi_heap_register`) and points the sandbox's Lua state at it (`lua_setallocf`). An app
that outgrows it gets "not enough memory" in its own dispatch, and the board stays online and takes
the next app (tested: a memory hog filled the arena, then a pushed app loaded and its collector freed
the hog's memory). Lua's own state and libraries (13 KB) were allocated before the switch and stay
in the shared heap.

### A rebuilt core for more of it

The prebuilt Arduino core keeps 88 KB of code in IRAM, which on the C6 is the same SRAM the heap
comes from, and holds its TLS record buffers for the whole session. `device/` rebuilds the core
(pioarduino's `custom_sdkconfig`) with Wi-Fi's extra and sleep paths, PHY and power-management sleep
code, FreeRTOS's non-ISR functions, the ring buffer and the heap's functions in flash (IRAM code
88 → 54 KB), TLS buffers allocated per record, and a 4 KB esp_timer stack (Arduino sets 8).

| | prebuilt core (`device-prebuilt-core/`) | rebuilt core (`device/`) |
|---|---|---|
| free at boot | 345 KB | 383 KB |
| after the 110 KB canvas | 239 KB | 278 KB |
| Lua arena | 64 KB | 88 KB |
| **free in the arena for apps** | **59 KB** | **84 KB** |
| shared heap, connected: free / largest block | 42 / 19 KB | 54 / 34 KB |
| shared heap, lowest (TLS handshake, app arriving) | 27 KB | 23 KB |

With the prebuilt core, an 80 KB arena left the shared heap a 14 KB largest block, too small for a
TLS reconnect. With the rebuilt core and a 64 KB arena the shared heap had 78 KB free (largest
block 57 KB), so the arena grew to 88.

### What fits

An app arrives as one WebSocket message (the app wrapped in Bench's shim when it mirrors), which is
parsed in the shared heap (ArduinoJson 7 copies the code string, so ~2-3x its size in large blocks)
and compiled in the arena (~4x its size). Bench's estimate (`src/resident/needs.ts`: ~6x the wrapped
size, fitting in 3/4 of the app memory) matched what the rebuilt core ran, below. Since 2026-10-27
the minifier also drops the spaces between tokens, a fifth of a minified app: the message is that
much smaller, compiling costs what it did (it goes by the token), and the estimate is 2x the message
plus 4x the code with its spaces, a few per cent under these:

| App, mirrored from Bench | Bench's estimate | rebuilt core (84 KB) | prebuilt core (59 KB) |
|---|---|---|---|
| hello, rainbow, bounce, lgfx hello, tilt ball | 17-27 KB | runs | runs |
| swiss clock (`datetime`) | 62 KB | runs | compiles, then every tick runs out of memory |
| water sim (12 KB wrapped) | 69 KB | compile runs out of memory | message can't be parsed |
| porous systems (13 KB wrapped) | 74 KB | message can't be parsed | message can't be parsed |
| LVGL apps (patterns, ...) | 66-144 KB | no `lvgl`; out of memory | |

No `lvgl`: luavgl's first bind alone keeps ~30 KB.

### A saved app makes the next push smaller

Resident reads the saved app from NVS before Wi-Fi starts and holds the source until the 20 s
countdown ends, so Wi-Fi, TLS and the WebSocket allocate around it. Once it compiles, its space is
freed in the middle of theirs, and the next app has to arrive in what's left in one piece. The
largest block in the shared heap once connected, by the app saved (sizes as sent):

| Saved app | largest block |
|---|---|
| a small test app | 36 KB |
| Flame C6 at 15 fps, 8.4 KB | 29 KB |
| Flame C6 at 30 fps, 8.6 KB (spaces dropped) | 25 / 29 KB (two boots) |
| Flame C6 at 30 fps, 10.4 KB | 18 / 21 KB (two boots) |

After a boot with the 10.4 KB flame saved, pushing the same flame (a 10.7 KB message) was dropped,
`[courier] ws: dropping non-JSON payload (10748 bytes): NoMemory`, and the board kept running the
one it had; it went through after a boot with the small app saved. The 8.6 KB flame pushed after a
boot with itself saved compiles, the shared heap 21 KB free at its lowest while it arrives. So an app
this board keeps saved should stay under ~9 KB as sent, or the next push may need a boot with
something small saved first.
