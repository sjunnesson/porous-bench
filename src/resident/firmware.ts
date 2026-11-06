// A prompt for Claude Code to build Resident firmware for the hardware selected on Bench and flash it,
// so the real device comes online on the relay with a device ID that Bench's Real device panel can
// mirror to. Grounded in Resident's own guide (docs/start-building.md) and Bench's profile of the part.

import type { Board } from '../sim/boards';
import type { PartSpec } from '../sim/controls/bench';
import type { DeviceProfile } from '../sim/devices/types';
import { chainWords } from '../sim/leds';
import { gpioName, type Wiring, wiring, wiringLines } from '../sim/wiring';

const RESIDENT = 'https://github.com/inanimate-tech/resident';
const START_BUILDING = 'https://raw.githubusercontent.com/inanimate-tech/resident/main/docs/start-building.md';
const SITE = 'https://bench.porous.systems';
// Served by Bench (api/device-skill.js) from GitHub's main, so each fetch is counted.
const DEVICE_SKILL = `${SITE}/device-skill.md?from=firmware`;

/** Official Resident firmware for these boards: build it as it is. */
const M5_ENVS: Record<string, string> = { 'm5stickc-plus2': 'm5stick', m5sticks3: 'm5sticks3' };

const REPO = 'https://github.com/sjunnesson/porous-bench';

/** Firmware Bench ships in its own repo (firmware/), by output and board: build it as it is. */
const BENCH_FIRMWARE: Record<string, { path: string; tested: boolean; note?: string }> = {
  'waveshare-epd-2.13-v4|waveshare-esp32-epaper-driver': {
    path: 'firmware/epd213/device',
    tested: true,
    note: 'Its panel may be the older V2 (ribbon HINK-E0213A22, controller IL3897): that build drives the V2, which is what the driver boards Bench has seen carry. If partial refreshes flash the whole screen, the panel is the other generation: rebuild with `-DEPD_PANEL=4`.',
  },
  'waveshare-esp32-c6-lcd-1.47|waveshare-esp32-c6-lcd-1.47': {
    path: 'firmware/c6-lcd147/device',
    tested: true,
    note: 'Its first build downloads and compiles ESP-IDF to rebuild the Arduino core with more RAM for apps (several minutes); `firmware/c6-lcd147/device-prebuilt-core` is the same firmware on the prebuilt core, quicker to build with less memory for apps. If the serial port doesn\'t show up, I hold BOOT while plugging it in.',
  },
  'waveshare-esp32-s3-touch-lcd-2|waveshare-esp32-s3-touch-lcd-2': {
    path: 'firmware/s3-lcd2/device',
    tested: true,
    note: 'Its first build downloads and compiles ESP-IDF to rebuild the Arduino core (code in PSRAM, a bigger instruction cache; about four minutes). If the serial port doesn\'t show up, I hold BOOT while pressing RST. Keep the board still for the first second after it boots: the IMU measures its gyro drift then.',
  },
  'seeed-xiao-round-display|seeed-xiao-esp32s3-round-display': {
    path: 'firmware/xiao-round/device',
    tested: true,
    note: 'Check with me that the display\'s power switch (on its rim) is on: it cuts the display\'s power even on USB, and the screen stays dark. If the serial port doesn\'t show up, I hold B (BOOT) on the XIAO while pressing R. It turns the picture 270° (`SCREEN_ROTATION` in its `platformio.ini`): up is away from a USB-C facing down.',
  },
  'guition-esp32-s3-4848s040|guition-esp32-s3-4848s040': {
    path: 'firmware/guition-4848s040/device',
    tested: true,
    note: 'Its USB-C goes through a CH340, so the port is `/dev/cu.usbserial-…` or `/dev/cu.wchusbserial-…`, and auto-reset flashes it with the case closed (BOOT and RST sit inside). It turns the picture 270° (`SCREEN_ROTATION` in its `platformio.ini`): up is away from a USB-C facing down. A board that was on Wi-Fi before (the factory firmware is) joins that network instead of opening the "Resident …" hotspot: if I want the hotspot, erase NVS (`esptool.py erase_region 0x9000 0x5000`) after asking me. Check with me that the picture fills the glass the right way up and stays put after the first app is pushed (saving it writes flash); if it doesn\'t, flash stage 1 (`firmware/guition-4848s040/device-no-resident`) and go through its test card with me, as the README says.',
  },
  'waveshare-epd-2.13-v4|esp32-s3-devkitc-1-n16r8': {
    path: 'firmware/epd213/device-s3',
    tested: false,
    note: 'It compiles but hasn\'t run on hardware yet: wire it as its README says and go through its first-flash checklist with me (PSRAM reported, orientation, partial refreshes in place, BOOT taps).',
  },
};

/** What bringing up Resident on real boards has taught, for hardware without firmware yet. */
const DISPLAY_LESSONS = [
  '- Push only what changed: each LVGL flush its own rectangle, an `lgfx`/`screen` flip only the 16×16 tiles drawn on since the last one (a canvas subclass that notes them). On the S3-Touch-LCD-2 that (rows at the time), LVGL\'s draw buffer in internal RAM and `-O2` took a flame from 3.4 to 28 fps; `firmware/s3-lcd2/device/lib/drivers/src/Lcd.cpp` in Bench\'s repo does it. Check the glass after changing the panel driver: an esp_lcd DMA driver completed every transfer and showed nothing.',
  "- Tiles, not rows: rows from the topmost thing drawn to the bottommost are most of the frame for anything spread out. On the Guition 4848S040 (480×480) five koi went from 17-24 ms flips to ~6.5 ms and the app from ~22 to ~29 fps; on the S3-Touch-LCD-2's SPI panel, a run of tiles to an address window each, from 14.1 to 5.4 ms; `firmware/guition-4848s040/device/lib/drivers/src/Lcd.h` in Bench's repo does it, and draws lines and pixels straight into the canvas: Adafruit GFX goes through two virtual calls a pixel, ~0.55 us a pixel there. It fills rectangles row by row too: Adafruit GFX fills them a column at a time, so on the C6 a 60×2 span took 50 us (the same pixels as 2×60, 14) and takes 10 row by row.",
  "- An RGB panel with its frame in PSRAM, on Arduino core 3.x (ESP-IDF 5): give the scan bounce buffers (`bounce_buffer_size_px`, a few rows), or it slides whenever PSRAM is busy, and use a core with ESP-IDF 6.0 or later (Arduino 4.0): IDF 5.5's bounce-buffer mode, with the `CONFIG_LCD_RGB_RESTART_IN_VSYNC` Arduino turns on, loses its place after one late interrupt (esp-idf#19070) and the picture glitches now and then. The Guition 4848S040 runs core 4.0.0-RC1 for it; `firmware/guition-4848s040/device/lib/panel/src/RgbPanel.cpp` in Bench's repo does it. On IDF 6.1 still set `CONFIG_LCD_RGB_RESTART_IN_VSYNC=n` (`custom_sdkconfig`): with it on, the driver never resets the count that picks the buffer to refill, so a late interrupt can leave the picture shifted by the bounce buffer's height, with stale pixels at the start of each buffer's first row, until the next one.",
  "- An RGB panel with bounce buffers: nothing may hold interrupts off for longer than the time to send one buffer less the copy (under 0.5 ms for 10 rows at 12 MHz), or the picture jumps. `heap_caps_get_largest_free_block` and `heap_caps_get_info` walk the whole heap with interrupts off: 4-10 ms with a Lua app's blocks in PSRAM. A heartbeat log doing that every 30 s made the Guition 4848S040's picture jump every 30 s; log `heap_caps_get_free_size` and `heap_caps_get_minimum_free_size`, which walk nothing.",
  '- An RGB panel scanned out of a frame buffer in PSRAM (IDF 4.4, Arduino core 2.x): write the frame with the CPU. GDMA (`esp_async_memcpy`) writes it twice as fast but starves the LCD\'s own DMA, and the picture slips over and over while the log reads normally; only the glass shows it.',
  "- An RGB panel on ESP-IDF 5 or later: don't keep a canvas and copy it into the scanned frame. Ask the driver for three frames (`num_fbs = 3`), draw straight into one that is neither on the glass nor about to be (turned as the picture is turned), and show it by passing a pointer into it to `esp_lcd_panel_draw_bitmap`: nothing is copied and it's scanned from the next vertical sync. `on_frame_buf_complete` (`on_bounce_frame_finish` on IDF 5) says when the refill interrupt has left a frame. Note the 16×16 tiles drawn in each frame: they are what the other frames lack, to be copied from the newest one before a tile is drawn on in part, and not at all before one is covered whole. With bounce buffers, don't write the frame back from the cache: the interrupt reads it through the same cache. On the Guition 4848S040 a canvas copied at each flip cost 30.5 ms for a whole frame and half of a full-screen app's time; with three frames that app went from 15 fps to 30 (firmware/guition-4848s040/device/lib/drivers/src/Lcd.cpp in the repo, and a hash of the picture to check a change like it leaves every pixel where it was).",
  "- With `lvgl`, set `LV_DEF_REFR_PERIOD` to 15 in `lv_conf.h`: the default 33 holds LVGL to 30 fps however fast it draws, and Resident runs LVGL's timers at most every 5 ms, so a period that isn't a multiple of 5 waits for the next one (16 gives 50 fps). On the S3-Touch-LCD-2 a small moving box went from 28.6 to 65.6 fps.",
  "- `on_tick` runs every 100 ms (10 fps) unless the board sets `SandboxConfig::tickIntervalMs`. Bench's colour boards set 33 (~30 fps): a small `lgfx` redraw took 4 ms of a 100 ms tick on the C6-LCD-1.47. The field is on Bench's Resident fork (`github.com/sjunnesson/resident`, commit `59cd3cf`: 0.12.0, the field, a loop pass that delivers every queued event, and `lgfx`'s `pushImage` and clip rectangle) until inanimate-tech/resident takes it. Leave it at 100 unless Bench's profile for the display says otherwise (`tickMs`): Bench ticks an app at the profile's rate, and the two must agree.",
  '- `flip()` must not wait for a slow panel: Resident aborts a Lua dispatch after 1 s. Snapshot the frame, return, and refresh from the driver\'s `update()`; for e-paper, one refresh at a time, newest frame wins, skip a frame identical to the one on the glass.',
  '- With `lvgl`, pin Resident 0.12.0 or later and the inanimate-tech/luavgl fork at `b982422` or later, as Bench\'s S3-Touch-LCD-2 firmware does: 0.12.0 calls the fork\'s `luavgl_app_reset` on every app reset and won\'t link without it. Resident keeps one Lua state for the board\'s life, and before 0.12.0 the outgoing app\'s `lvgl.Timer`s went on running against its deleted objects (an error box on the screen, not on serial).',
  "- With `lvgl`, give Arduino's loop task more than its 8 KB: LVGL draws on it, and an app with 72 transformed objects needed 8.3 KB and rebooted the board (`Stack canary watchpoint triggered`). `SET_LOOP_TASK_STACK_SIZE(16 * 1024)` next to `setup()`, and print `uxTaskGetStackHighWaterMark(nullptr)` so you can see what's left.",
  "- With `lvgl`, code running from flash and internal RAM to spare, put LVGL's hot code in IRAM: `#define LV_ATTRIBUTE_FAST_MEM IRAM_ATTR` (with `#include <esp_attr.h>`, guarded by `#if !defined(__ASSEMBLER__)`) in `lv_conf.h`. On the Guition 4848S040 it took five rings from 32 passes a second to 38-47. Turn off the colour formats nothing draws to (`LV_DRAW_SW_SUPPORT_RGB888`, `XRGB8888`, `RGB565A8`, `L8`, `AL88`, `I1` to 0: RGB565, ARGB8888 for layers and A8 for fonts stay), or IRAM costs 63 KB rather than 25, and raise `LV_INV_BUF_SIZE` to 64: past that many changed areas in a frame LVGL repaints the whole screen. With code running from PSRAM (the next lesson) IRAM gains nothing more: leave it out and keep the RAM.",
  "- With octal PSRAM and LVGL, rebuild the Arduino core (pioarduino's `custom_sdkconfig` in platformio.ini, ~5 minutes the first build) with `CONFIG_SPIRAM_XIP_FROM_PSRAM=y`: code and constants run from PSRAM, which answers a cache miss faster than quad flash, for 2.7 MB of PSRAM and no internal RAM. On the Guition 4848S040 Patterns' Bars went from 33 passes a second to 49. A bigger instruction cache (`CONFIG_ESP32S3_INSTRUCTION_CACHE_32KB=y`, 16 KB of internal RAM) gave LVGL screens another 16-23%, and a bigger data cache (`CONFIG_ESP32S3_DATA_CACHE_64KB=y` with `CONFIG_ESP32S3_DATA_CACHE_LINE_64B=y`, 32 KB) took strided full-screen fills from 20 fps to 30 where the panel's scan pulls its frame through that cache. Measure each: they cost what they cost whether or not your app gains. On the S3-Touch-LCD-2 (an SPI panel) the first two took Patterns' untuned Orbits from 29 passes a second to 42 and Bars from 32 to 48, and the data cache gained nothing and left LVGL's own heap (the next lesson) no room: Orbits fell back to 28.",
  "- With `lvgl`, give LVGL a heap of its own. It allocates two blocks for every shape it draws, and through the system heap each takes the heap's lock with interrupts off: 7.5% of the core in a profile of Patterns. `LV_STDLIB_CUSTOM` in `lv_conf.h`, and an `lv_malloc_core` that takes small blocks from 32 KB chunks made into heaps with `multi_heap_register` (no lock: LVGL runs on one task), only once an app uses LVGL and only above a floor of internal RAM (firmware/guition-4848s040/device/lib/drivers/src/LvglAlloc.c in the repo). luavgl frees an `lv_strdup` with `free()` in `lvgl.Font()`, which then corrupts the heap: compile luavgl with `-Dfree=lv_free` (firmware/core3.py). On the S3-Touch-LCD-2 the app's core spent 36% of an untuned screen waiting for that lock: 16 passes a second became 30.",
  "- An SPI panel through Arduino's SPI on an S3 (`Adafruit_GFX::writePixels`, `SPI.writePixels`): the peripheral sends 64 bytes at a time, and the core makes each 64 ready only after the last has gone, reading the frame out of PSRAM and swapping bytes while the bus sits idle. Make the next 64 ready while the last are being sent, then write the same registers in the same order (`sendPixels` in firmware/s3-lcd2/device/lib/drivers/src/Lcd.cpp, which takes `GPSPI2` after `setAddrWindow`): a whole 240×320 frame went from ~24 ms to 20.1, and an app repainting most of the screen every tick from 27 fps to 30. Compare the words you hand the peripheral with the core's own arithmetic for every length before trusting it, and look at the glass.",
  "- Profile before optimising: a timer interrupt that notes the PC FreeRTOS saved for the interrupted task (the second word of the frame at the task's stack top) and two return addresses, named on the host with `nm` and `addr2line`, the ROM's from PlatformIO's tool-esp-rom-elfs (firmware/guition-4848s040/device/lib/drivers/src/Profiler.h and firmware/prof.py in the repo). A sample at the ROM's `_xtos_set_intlevel` waited for a critical section to end; its callers say whose.",
  "- PlatformIO doesn't notice a changed `lv_conf.h`: LVGL includes it through a macro. Delete `.pio/build/<env>/lib*/lvgl` after changing it, or the old LVGL is flashed and the build still says SUCCESS.",
  "- Lua lets C calls nest 200 deep (`LUAI_MAXCCALLS`), far more than a board's stack: a recursive `pcall` or `__index` panicked a C6 (8 KB) at ~9 levels and an S3 (16 KB) at ~30. With 16 KB, build with `-DLUAI_MAXCCALLS=25`: the app gets a Lua error and every bundled app still compiles (the parser counts its nesting against the same limit, so don't go much lower).",
  "- With PSRAM, Arduino's prebuilt core still has mbedTLS allocate from internal RAM, ~40 KB for a session, and with too little internal RAM a board can't connect (`mbedtls_ssl_setup returned -0x008D`). First thing in `setup()`, `mbedtls_platform_set_calloc_free` with a calloc that takes `MALLOC_CAP_SPIRAM` first moves it, no core rebuild. Keep LVGL from taking the rest: `LV_STDLIB_CUSTOM` in `lv_conf.h` and your own `lv_malloc_core` with a floor of internal RAM (firmware/s3-lcd2/device/lib/drivers/src/LvglAlloc.c in the repo). Measure the fps and the free RAM after each.",
  '- On a 1-bit panel, give the `lgfx` module a `Resident::LgfxTarget` that draws into the same 1-bit canvas as `screen` (luminance >= 50% is white) instead of a full RGB565 sprite.',
  "- Bench's apps can call `lgfx`'s `pushImage(x, y, w, h, data[, palette[, transparent]])` (RGB565 big-endian, or a byte a pixel into a palette) and `setClipRect` / `clearClipRect`, which Resident has only on Bench's fork (commit `59cd3cf`). `LgfxTarget`'s defaults draw an image a pixel at a time and clip only images; a target over a canvas of its own should write both kinds of image straight into the buffer and clip every path that writes it (pixels, fast lines, rectangles, its own line drawing, text, `screen`'s calls). On the Guition 4848S040 an isometric scene redrawn a 16 px cell at a time from a backdrop and sprites went from 245 ms a tick (Lua composing the pixels) to 34; `firmware/guition-4848s040/device/lib/drivers/src/Lcd.h` in Bench's repo does it. Resident resets extensions in the order of `cfg.extensions`, so the screen driver's reset, which clears the frame for the next app, runs before the `lgfx` module clears the clip: clear the canvas's clip there first, or an app that left one set has the next start blank only inside it.",
];
const LESSONS = [
  "- On a board whose serial port is the chip's own USB (ESP32-S3, -C6, -C3 with `ARDUINO_USB_MODE=1`), call `Serial.setTxTimeoutMs(0)` after `Serial.begin`. Plugged into a computer with nothing reading the port, every print waits for room: up to 2 s on Arduino core 3.x (20 tries of 100 ms), 100 ms on 2.x. Resident's status lines alone froze the C6-LCD-1.47's app for ~30 s at a time, and never while a monitor was open, which made it look like the app's fault. On a USB-serial chip (CH340, CP2102) prints never wait.",
  '- Check the real part against Bench\'s profile before trusting it: read the ribbon or the back sticker (a "2.13 V4" may turn out to be a V2 with another controller). A test card that looks right can hide the wrong controller; partial refresh is what tells them apart.',
  '- Measure app memory with `heap_caps_get_free_size(MALLOC_CAP_8BIT)` and `heap_caps_get_largest_free_block(MALLOC_CAP_8BIT)`, not `ESP.getFreeHeap()`: on a classic ESP32 that also counts IRAM Lua can\'t use. Without PSRAM about 70 KB is left once Wi-Fi and TLS are up; LVGL\'s first bind keeps ~30 KB, so leave `lvgl` out there.',
  '- Without PSRAM, give Lua a heap of its own: Resident\'s allocator takes whatever is free, and an app that grows (or just fragments the heap with small blocks) leaves TLS without the 16 KB block a reconnect needs, so the board drops off the relay and can\'t be sent the next app. Take one block before Wi-Fi starts, make it a heap with `multi_heap_register`, and point Lua at it with `lua_setallocf` from a driver\'s `registerModule` (`LuaArena.h` in Bench\'s C6 and e-paper firmware, under `firmware/*/device/lib/drivers/`, does this): an app that doesn\'t fit then fails with "not enough memory" and the board stays online.',
  '- Bench sends the time zone its apps run in before each app it mirrors, as `{ channel: "bench", type: "timezone", data: { tz } }`: register `sandbox.onMessageWithChannel("bench", …)` and call `sandbox.setTimezone(tz)`, skipping a zone already applied. A Resident `hello` would set the zone too, but it also makes the board drop un-channelled messages until reboot, which `/resident:push-app` still sends.',
  '- Opening the serial port resets a board with a USB-serial bridge (DTR/RTS); open it with both lines released, or it can stay held in reset.',
  '- Resident keeps the last app for the next boot in NVS by default, and a big app silently fails to save there (`persist_too_big`), so a reboot brings back an older one. Give the sandbox a `persistentStore` that keeps the app on a LittleFS partition (`AppStore.h` in Bench\'s S3-Touch-LCD-2 firmware), and call its `begin()` yourself: Resident only starts its own default store.',
  "- A saved app that crashes the board comes back at every boot and crashes it again, for ever. Count crashes in `RTC_NOINIT_ATTR` memory from `esp_reset_reason()` (panic and the watchdogs), clear the count once the board has been up a minute, and after two in a row have the store's `load()` return nothing: the board stays connected and a new push runs (firmware/s3-lcd2/device/lib/drivers/src/BootGuard.h in the repo).",
  '- A key on a strapping pin (IO12 on the Waveshare e-Paper Driver Board) may have no pull-up of its own: enable `INPUT_PULLUP` after boot.',
  '- A touch chip\'s INT may pulse rather than stay low while touched (the Round Display for XIAO\'s CHSC6X: ~72 pulses a second, one per report): latch INT\'s falling edges with an interrupt and read the chip after one, or while a finger is down, rather than only when a poll happens to see INT low. Many touch chips don\'t answer at all while idle, so a failed read is "no finger". Give the I2C bus a short timeout (`Wire.setTimeOut`): a display board with its power switched off leaves the bus without pull-ups, and a scan hangs.',
  '- Map an IMU onto Bench\'s frame on the real board: face-up at rest accel ≈ (0, 0, +1) g, the right edge tipped down reads +x and the bottom edge +y, so a ball rolls by (ax, ay). Chips are often mounted turned (the S3-Touch-LCD-2\'s QMI8658 has x and y swapped as well as flipped), and a diagonal tilt can hide a swap: test one edge at a time. Gyros drift a few °/s at rest: average them at boot and subtract.',
  `- When it works, tell me the libraries it has and the app memory you measured, so Bench's board entry (src/sim/boards.ts in ${REPO}) lists the right apps for it.`,
];

const pins = (w: Record<string, number>) =>
  Object.entries(w)
    .map(([k, v]) => `${k} ${v}`)
    .join(', ');

/** The board chosen in Bench for a bare module or an LED chain, still to be confirmed. */
function chosenBoard(board: Board, what: string): string {
  return `- **Board:** a ${board.name}, my choice in Bench (${board.note}). Confirm it with me, and ask ${what} before writing code.`;
}

function hardwareSection(p: DeviceProfile, board?: Board, wired?: Wiring): string[] {
  const lines: string[] = [];
  // A bare module or LED chain wired to a dev board, as Bench's Wiring view shows it.
  const shown = wired?.output && !wired.output.wires.some((w) => w.missing) ? wiringLines({ ...wired, parts: [] })[0] : undefined;
  const dinGpio = wired?.output?.wires.find((w) => w.pin === 'DIN')?.gpio;
  const din = dinGpio !== undefined ? gpioName(wired, dinGpio) : `GPIO ${p.wiring?.DIN ?? 18}`;
  const leds = p.look.leds;
  if (leds) {
    const n = p.width * p.height;
    const shape = leds.layout === 'grid' ? `a ${p.width}×${p.height} matrix, ${chainWords(leds.chain)}` : leds.layout === 'ring' ? `a ring of ${n}` : `a strip of ${n}`;
    lines.push(
      `- **Output:** WS2812B addressable LEDs, ${shape} (${n} LEDs, 800 kHz one-wire, GRB). Bench assumes data in on **${din}** of an ESP32 board.`,
      board ? chosenBoard(board, shown ? 'whether the strip is wired as below' : 'which pin the data line is on') : '- **Board:** any ESP32 dev board. Ask me which one I have (and which pin the data line is on) before writing code.',
    );
    if (shown) lines.push(`- **Wiring, as Bench's Wiring view shows it:** ${shown}.`);
  } else {
    const turned = (p.firmwareRotation ?? 0) % 2 === 1;
    lines.push(
      `- **Display:** ${p.name}: ${p.width}×${p.height} ${p.tech.toUpperCase()} (${turned ? `apps see it as ${p.height}×${p.width}, rotation ${p.firmwareRotation}` : 'apps see it as is'}), ${p.controller} over ${p.bus.kind.toUpperCase()} at ${p.bus.hz >= 1e6 ? `${p.bus.hz / 1e6} MHz` : `${p.bus.hz / 1e3} kHz`}${p.bus.i2cAddress ? `, address 0x${p.bus.i2cAddress.toString(16)}` : ''}.`,
    );
    if (p.ram) lines.push(`- **Controller RAM:** ${p.ram.width}×${p.ram.height}; the visible area starts at x+${p.ram.offsetX}, y+${p.ram.offsetY}.`);
    if (p.wiring) lines.push(`- **Wiring (GPIO):** ${pins(p.wiring)}.`);
    else {
      const part = p.enclosure?.parts?.find((x) => x.kind === 'header');
      const header = part?.kind === 'header' ? part.label : undefined;
      lines.push(
        board
          ? `- **Module:** a bare display module${header ? ` (pins: ${header})` : ''}.`
          : `- **Board:** this is a bare display module${header ? ` (pins: ${header})` : ''}, wired to an ESP32 board. Ask me which board I have and how it's wired before writing code.`,
      );
      if (board) lines.push(chosenBoard(board, shown ? "whether it's wired as below" : "how it's wired"));
      if (shown) lines.push(`- **Wiring, as Bench's Wiring view shows it:** ${shown}.`);
    }
  }
  const buttons = (p.enclosure?.parts ?? []).flatMap((x) => (x.kind === 'button' && x.input !== undefined ? [{ label: x.label ?? 'button', input: x.input }] : []));
  if (buttons.length) lines.push(`- **Buttons:** ${buttons.map((b) => `${b.label} = button ${'AB'[b.input] ?? b.input} (index ${b.input})`).join(', ')}.`);
  if (p.builtins?.length) lines.push(`- **Also on the board:** ${p.builtins.map((b) => (b === 'imu' ? 'an IMU' : 'a buzzer')).join(' and ')}.`);
  for (const note of p.porting ?? []) lines.push(`- ${note}`);
  if (p.url) lines.push(`- Datasheet / docs: ${p.url}`);
  return lines;
}

function planSection(p: DeviceProfile, board?: Board): string[] {
  const shipped = board && BENCH_FIRMWARE[`${p.id}|${board.id}`];
  if (shipped) {
    return [
      `Bench ships firmware for this display on this board: \`${shipped.path}\` in ${REPO} (its README has the wiring, the pins and what was learnt bringing it up). ${shipped.tested ? 'It has been tested on hardware. ' : ''}It pulls Resident from GitHub, pinned by commit.`,
      `1. Clone ${REPO} and build \`${shipped.path}\` as it is (\`pio run\`).`,
      '2. Find the board\'s port (`pio device list`), confirm it with me, then flash: `pio run -t upload`.',
      ...(shipped.note ? [`3. ${shipped.note}`, '4. Go to step "First boot" below.'] : ['3. Go to step "First boot" below.']),
    ];
  }
  const env = M5_ENVS[p.id];
  if (env) {
    return [
      `Resident ships working firmware for this board: \`examples/m5stick-demo/device\` in ${RESIDENT}, PlatformIO env \`${env}\`${env === 'm5stick' ? ' (or `m5stick-lvgl` for the optional lvgl module)' : ''}.`,
      '1. Clone the Resident repo and build that example as it is (it links Resident from the repo itself).',
      '2. Find the board\'s port (`pio device list`), confirm with me, then flash: `pio run -e ' + env + ' -t upload`.',
      '3. Go to step "First boot" below.',
    ];
  }
  const c6 = /esp32-c6/i.test(p.id);
  const lines = [
    `Follow Resident's guide for new hardware, written for coding agents: ${START_BUILDING}. It has three flashable stages; do them in order and check each with me on the real board before the next:`,
    '1. **Bring-up, no Resident:** the smallest PlatformIO project that boots, prints chip info over serial and ' +
      (p.look.leds ? 'runs a rainbow across every LED (check the count and the colour order).' : 'draws a test card that proves orientation, offsets and colours (red, green, blue bars, a 1 px border on the visible edge).'),
    '2. **Add Resident:** Wi-Fi through WiFiManager\'s captive portal, the WebSocket to `resident.inanimate.tech` at `/devices/<deviceId>` (the guide\'s `onTransportsWillConnect` override), and a status screen showing WiFi → Connecting → Connected → the **device ID**.',
    '3. **Add drivers** (one `Resident::Driver` each, in `lib/drivers/`) so Bench\'s apps run unchanged. Bench\'s device skill is the surface to match: ' +
      DEVICE_SKILL +
      (p.look.leds
        ? '. Implement its `leds` module exactly (`count`, `width`, `height`, `xy`, `set`, `set_rgb`, `get`, `fill`, `clear`, `hsv`, `brightness`, `show`, and `on_frame(fn, fps)` as a frame timer calling the app between ticks; if Resident can\'t call into Lua from a driver timer, say so and document `on_tick` as the fallback).' +
          (p.look.leds.layout === 'grid'
            ? ` Then \`lgfx\` on the matrix, as Bench has it: a ${p.width}×${p.height} canvas (one pixel per LED) whose \`flip()\` copies each pixel to its LED through \`xy\` and shows the chain, so Bench's matrix apps that draw text and shapes run unchanged.`
            : '')
        : '. Start with `screen` (the M5Stick drawing calls) on a full-frame canvas pushed in one transfer by `flip()`, then the board\'s buttons as `tap` / `hold` events, then `lgfx` (the LovyanGFX-style calls Bench apps use). ' +
          (p.touch
            ? `Then the ${p.touch.controller} touch panel as Bench's \`touchscreen\` module: \`read()\` returning \`{ pressed, x, y }\` in the coordinates apps draw in, and \`touch_down\` / \`touch_move\` (at most one per loop) / \`touch_up\` / \`touch_tap\` driver events with \`{ x, y }\` (a tap: released within 500 ms, moved under 10 px). `
            : '') +
          lvglAdvice(board)),
    '',
    'Practicalities:',
    '- Install PlatformIO if it\'s missing (`brew install platformio` or `pipx install platformio`). Put the project in a new folder here, and clone Resident next to it for the `symlink://` lib_dep, as its examples do.',
    '- Resident builds as C++17 (`build_unflags = -std=gnu++11`, `build_flags = -std=gnu++17` on core 2.x), and its firmware is about 1.2 MB: give it a custom `partitions.csv` with a big enough app slot.',
    `- Bench's own boards are moving off Resident's examples' \`espressif32@6.x\` (Arduino core 2.0.17, the last 2.x) to core 3.3.12, pioarduino's \`platform = https://github.com/pioarduino/platform-espressif32/releases/download/55.03.312/platform-espressif32.zip\` (pinned: its \`stable\` moves, and 4.0 is coming): the C6 and the S3-Touch-LCD-2 build on it. Resident's libraries need the fixes in \`firmware/core3.py\` in ${REPO} there (\`extra_scripts = pre:core3.py\`), Courier's \`esp_websocket_client\` as a library, and \`lib_ignore = SD\` with LVGL; \`ledcSetup\`/\`ledcAttachPin\` become \`ledcAttach(pin, freq, bits)\` and \`ledcWrite(pin, …)\`. Core 3.x compiles C++17 and newer already, so skip the \`gnu++17\` flags. ESP-IDF 5 keeps ~75 KB less internal RAM free than 4.4 (an S3 with PSRAM doesn't mind).`,
  ];
  if (c6) {
    lines.push(
      '- **ESP32-C6:** the `espressif32@6.x` platform in Resident\'s examples is too old for the C6: it needs core 3.x (above), board `esp32-c6-devkitc-1`.',
      `- Resident's libraries need three fixes on core 3.x, in \`firmware/c6-lcd147/\` and \`firmware/core3.py\` in ${REPO}: Courier's \`esp_websocket_client\` from Espressif's component registry (ESP-IDF 5 moved it out of the core), \`<string>\` force-included for Esp32Lua's C++ wrapper, and Esp32Lua's standalone \`lua.c\`/\`luac.c\` left out of the build (\`core3.py\`).`,
      '- The C6 has 512 KB of SRAM and no PSRAM: a full RGB565 frame competes with Wi-Fi, TLS and Lua for it. Rebuilding the core with less code in IRAM (pioarduino\'s `custom_sdkconfig`) frees ~36 KB. That rebuild compiles ESP-IDF with the project\'s `build_flags`: an `-O2` there makes newlib\'s `memcpy.c` stop on `#error ... DIG-694`, so add it file by file in a build middleware (`core3.py`\'s `custom_optimize`).',
      '- It has native USB: add `-DARDUINO_USB_MODE=1 -DARDUINO_USB_CDC_ON_BOOT=1` or serial stays silent. If the port doesn\'t show up, I hold BOOT while plugging it in.',
    );
  }
  if (/esp32-s31|mosaico/i.test(p.id)) {
    lines.push(
      '- **ESP32-S31:** a new chip, and the PlatformIO setup above may not build for it yet. Espressif\'s own BSP needs ESP-IDF 6.2 (`idf.py --preview set-target esp32s31`), and Arduino-ESP32\'s first S31 code is in 4.0.0-RC1, a pre-release. Before stage 1, find out what builds a blink for `esp32s31` today (pioarduino, Arduino as an ESP-IDF component, or plain ESP-IDF with Resident as a component), tell me, and agree the route with me.',
    );
  }
  if (board?.id === 'seeed-xiao-esp32s3') {
    lines.push(
      '- **XIAO ESP32S3:** PlatformIO board `seeed_xiao_esp32s3` (8 MB flash, 8 MB octal PSRAM). Its pins are printed D0–D10, not GPIO numbers: the wiring above gives both.',
      '- It has native USB only: add `-DARDUINO_USB_MODE=1 -DARDUINO_USB_CDC_ON_BOOT=1` or serial stays silent. If the port doesn\'t show up, I hold B (BOOT) while plugging it in.',
    );
  }
  lines.push('- Flashing replaces whatever is on the board: confirm the port with me before the first upload.');
  lines.push('', 'Lessons from boards Bench has already brought up:', ...(p.look.leds ? [] : DISPLAY_LESSONS), ...LESSONS);
  return lines;
}

function lvglAdvice(board?: Board): string {
  if (!board || board.appRamKb === undefined) return 'The `lvgl` module (luavgl) is optional: only if memory allows.';
  return board.libraries.includes('lvgl')
    ? `Then \`lvgl\` (luavgl, as Resident's \`m5stick-lvgl\` env does it): Bench lists LVGL apps for this board.`
    : 'Skip `lvgl`: this board has no PSRAM and LVGL doesn\'t fit next to Wi-Fi and TLS; Bench lists only `screen` and `lgfx` apps for it.';
}

/** The parts I added to the bench, wired to the board as Bench's Wiring view shows them. */
function partsSection(wired?: Wiring): string[] {
  if (!wired?.parts.length || !wired.pinout) return ['- Sensors and controls (encoder, PIR, light …) come from Bench while it mirrors, so the firmware needs no drivers for them.'];
  const lines = wiringLines({ ...wired, output: undefined });
  return [
    '- **Parts on my bench**, wired as Bench\'s Wiring view shows them. While Bench mirrors, their readings come from Bench, so the firmware needs no drivers for them; if I ask for the real parts to work on their own, put their drivers on exactly these pins:',
    ...lines.map((l) => `  - ${l}`),
    ...[...(wired.pinout.notes ?? []), ...wired.problems].map((p) => `  - ${p}`),
  ];
}

/**
 * The firmware prompt, as Markdown. `board`: the board chosen in Bench for a bare module or LEDs.
 * `hardware`: what's on the bench (`Bench.hardware()`), for the pins its parts go to.
 */
export function firmwarePrompt(device: DeviceProfile, board?: Board, hardware: (PartSpec & { builtin: boolean })[] = []): string {
  const wired = board ? wiring(device, board, hardware) : undefined;
  return [
    `Put Resident firmware on my ${device.look.leds ? `ESP32 driving a ${device.name}` : device.name}, so it comes online on Resident's relay with a device ID. I'll then drive it from porous.systems Bench (${SITE}): its Real device panel mirrors an app onto the device and streams the virtual inputs to it.`,
    '',
    '## The hardware (from Bench)',
    ...hardwareSection(device, board, wired),
    ...partsSection(wired),
    '',
    '## Plan',
    ...planSection(device, board),
    '',
    '## First boot',
    '- The board opens a "Resident …" Wi-Fi hotspot: tell me to join it from my phone and enter my Wi-Fi. Then watch the serial monitor (`pio device monitor`) until it connects and prints its device ID.',
    '- Tell me the device ID. In Bench I paste it into **Real device** and press **Mirror**.',
    board && BENCH_FIRMWARE[`${device.id}|${board.id}`]
      ? `- Its \`DEVICE-SKILL.md\` (next to its \`platformio.ini\`) lists exactly which modules it has: use it when writing apps for it.`
      : '- Write a `DEVICE-SKILL.md` for this firmware (the Resident plugin\'s write-device-skill skill does this), listing exactly which modules it has, so apps can be written for it.',
    '',
    '## Rules',
    '- Ask me before anything that touches the hardware (flashing, erasing) and whenever a pin or board detail isn\'t certain.',
    '- Keep each stage buildable; if a later one breaks, go back to the last one that worked.',
    '',
  ].join('\n');
}
