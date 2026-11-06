# porous.systems Bench (Resident simulator board)

Bench is a browser simulator that runs Resident apps on a choice of virtual displays. Its board
surface is the M5StickC Plus2's (`screen`, `imu`, `buzzer`, `button`, two buttons) plus `lgfx`, on
whichever display the user has selected, plus Bench drivers for the hardware on its desk (`dial`,
`trigger`, `ld2410`, `light`, `pir`, `climate`, `touch`, `switch`, `joystick`, `keypad`, `ir`, `rfid`,
`mic`, `tof`, `thermal`, `co2`, `pulse`), `touchscreen` on a display with a touch panel, and `leds`
when the output is an LED chain. Apps written for the M5Stick run unchanged; apps that read
`screens.get("main")` adapt to every display.

Pass this file to the Resident plugin: `/resident:create-app --device-skill docs/resident/DEVICE-SKILL.md …`

## Hardware

**Screen** `"main"`: the selected display. Ask for its facts, never assume them:

```lua
local s = screens.get("main")   -- { name, w, h, shape, depth = 16 | 1, scheme = "dark" | "light", dpi?, brightness,
                                --   model, controller, tech = "lcd" | "amoled" | "oled" | "epaper" | "led" }  (the last three are Bench extras)
```

| Display | Size seen by apps | depth | scheme | Notes |
|---|---|---|---|---|
| M5StickC Plus2 / M5StickS3 | 240×135 (landscape) | 16 | dark | the default Resident board |
| Waveshare ESP32-C6-LCD-1.47 | 172×320 | 16 | dark | rounded corners: keep ~20 px clear |
| Waveshare ESP32-S3-Touch-LCD-2 | 240×320 | 16 | dark | touch panel (`touchscreen`); IMU |
| Waveshare ESP32-S3-Touch-AMOLED-1.32 | 466×466 | 16 | dark | round (`shape = "round"`): only the circle of radius 233 shows; AMOLED, black is off; touch panel (`touchscreen`) |
| Seeed Studio Round Display for XIAO | 240×240 | 16 | dark | round (`shape = "round"`): only the circle of radius 120 shows; touch panel (`touchscreen`) |
| Guition ESP32-S3-4848S040 | 480×480 | 16 | dark | 4" wall panel; touch panel (`touchscreen`); no buttons, so drive the app by touch; a `flip()` sends only the 16×16 squares drawn on since the last |
| Espressif ESP-Mosaico | 480×480 | 16 | dark | AMOLED, black is off; rounded corners: keep ~70 px clear; touch panel (`touchscreen`); IMU |
| Waveshare ESP32-S3-AMOLED-1.91 | 536×240 (landscape) | 16 | dark | AMOLED, black is off; IMU; the Touch version adds a touch panel (`touchscreen`) |
| 1.3" ST7789 | 240×240 | 16 | dark | |
| SSD1306 OLED | 128×64 or 128×32 | 1 | dark | colours threshold to lit/unlit at 50% brightness |
| 2.13" e-paper | 122×250 | 1 | light | every `flip()` that changes the frame is a refresh (0.2 s partial, and a 1.9 s full one after every 10 partials); it runs in the background, only the newest frame reaches the glass, and an unchanged frame isn't refreshed. Each app starts on blank paper |

On 1-bit screens use pure white for marks on a dark scheme, pure black on a light one.

**Buttons**: two, indices 0 (key A) and 1 (key B). Gestures arrive in `on_event`: `tap`
(`e.data.index`, `e.data.count`) on a release before 500 ms, `hold` (`e.data.held = true` at 500 ms,
`false` on release). A legacy `button` event fires alongside `tap`.

**IMU**: 6-axis, body frame. At rest face-up `imu.accel()` ≈ `(0, 0, 1)` g; the user tilts it with a
pad and can shake it. `imu.gyro()` in °/s. `imu.temp()` returns 0.

**Buzzer**: square-wave piezo, 20–20000 Hz (clamped), durations up to 5000 ms.

## Which outputs list an app

Bench lists an app only for outputs, and boards, that can run it. Say what the code can't show in
the header:

```lua
-- Tilt ball: roll a ball with the IMU   -- line 1: "Name: description"
-- @output display                       -- display (the default) | strip (strips and rings) | matrix
-- @needs motion color touch 240x135     -- only the ones that apply
```

- `@output`: an app that names its output and arrives (pushed, dropped or run) while Bench shows
  another kind switches Bench to that kind: a matrix app pushed at a display gets the LED matrix.
- `motion`: it animates (so not e-paper). `color`: it means nothing in 1-bit. `touch`: it needs a
  touch panel. `WxH`: the smallest screen, as apps see it, that its fixed layout fits. An app that adapts through `screens.get`
  needs none of these.
- Bench reads the rest from the code: the libraries it binds (`lvgl.bind` needs a board with LVGL)
  and its size (the memory it takes on a real board).

## Boards: libraries and memory

The board driving the output decides what an app gets. Bench shows it under the display, with a
**Board** menu for bare modules and LEDs:

| Board | Libraries | Memory for apps |
|---|---|---|
| M5StickC Plus2, M5StickS3, ESP32-S3 DevKitC-1 N16R8, Seeed Studio XIAO ESP32S3 (on its own or behind the Round Display), Waveshare ESP32-S3-Touch-LCD-2, Waveshare ESP32-S3-Touch-AMOLED-1.32, Waveshare ESP32-S3-AMOLED-1.91 and its Touch version, Guition ESP32-S3-4848S040, Espressif ESP-Mosaico (ESP32-S31) | `screen`, `lgfx`, `lvgl` | PSRAM (MBs) |
| ESP32 without PSRAM (Waveshare ESP32 e-Paper Driver Board, ESP32 DevKitC) | `screen`, `lgfx`; no `lvgl` | ~52 KB |
| Waveshare ESP32-C6-LCD-1.47 | `screen`, `lgfx`; no `lvgl` | ~84 KB |

A library the board's firmware doesn't have isn't there at all: on a board without LVGL the global
`lvgl` is nil, so `lvgl.bind` fails with "attempt to index a nil value (global 'lvgl')", on Bench as
on the board (Bench adds why). The same goes for `leds` on a display and `screen` on LED outputs, and
`lgfx` on a strip or ring (a matrix keeps it). `if lvgl then … end` is how an app checks.

On a board without PSRAM, draw with `lgfx` (or `screen`) and keep the app small: receiving and
compiling it takes about 6x its size, so stay under ~4 KB of Lua (~8 KB on the C6), and `datetime`
costs ~35 KB once touched. There Lua has a heap of its own: an app that doesn't fit stops with "not
enough memory" and the board stays online for the next one.

Each dispatch (loading the app, `init`, a tick, an event) gets 1000 ms. Past that, a board raises
`execution deadline exceeded (1000 ms)` and the app carries on. Bench counts the 1000 ms as about 4
million Lua instructions, what an ESP32-S3 runs (the C6 runs far fewer: see below). Nothing times an
LVGL callback, a coroutine that never yields back, or a dispatch that catches the deadline error
with `pcall` and carries on. On a board those hang it, so Bench halts the app.

As on a board, an error doesn't end the app: one in `init` (or in the top-level code, past the
callbacks defined above it) is reported and `on_tick` and `on_event` still run. The board takes
`init`, `on_tick` and `on_event` once the top-level code has run: assigning `on_tick` later, or
defining `on_event` inside `init`, changes nothing. Each call gets a fresh `ctx`.

## Speed on a real board

Bench runs Lua 50 to 100 times faster than a board, so an animation that is smooth on Bench can
crawl on the glass. `on_tick` comes every 100 ms by default; Bench's firmware for the
S3-Touch-LCD-2, the XIAO Round Display, the C6-LCD-1.47 and the Guition 4848S040 ticks every 33 ms
(~30 fps, `SandboxConfig::tickIntervalMs`). Move things by `dt_ms`, not a fixed step a tick, so an
app runs at the same speed on either. A tick that takes longer than the interval (its Lua plus
the `flip()` that pushes the frame) delays the next one, and the frame rate drops with it. On the
S3-Touch-LCD-2, the XIAO and the C6 a `flip()` sends only the 16×16 squares drawn on since the last
one, and Bench times a flip the same way, so drawing less is faster on both. On the Guition (its
firmware since 2026-11-06) a flip sends nothing: the board draws into a frame that isn't on the
glass and shows it at the next vertical sync, 42 times a second at most, so there a frame costs
what drawing it costs.

- **ESP32-C6: no FPU.** Every float operation is emulated, and `math.sin`, `math.sqrt` and `^` cost
  the most. Measured on the C6-LCD-1.47 with a full-screen `lgfx` flame: about 137,000 Lua
  instructions and 985 draw calls a tick took ~285 ms (3.5 fps); about 50,000 instructions and 609
  calls took ~104 ms (10 fps). Pushing the whole 172×320 frame is ~32 ms of that; `flip()` pushes
  only the rows drawn since the last one, so an app that redraws only what moves pushes less.
- **For 10 fps on the C6**, keep a full redraw to roughly 50,000 instructions and 600 draw calls:
  - Build lookup tables in `init` (shapes, colour ramps) instead of calling `sin` or `^` for
    every row; work out what varies per frame at a dozen points and blend between them.
  - Blend colours with integers (`(a + (b - a) * k // 256)` per channel, `k` 0–256), not floats.
  - Don't create closures or tables in a loop that runs each frame: they're garbage in a small heap.
  - Fewer, bigger draw calls: merge rows of one colour into one `fillRect`, and step soft
    things (glows, gradients) 4 rows at a time.
- **ESP32-S3 with LVGL (S3-Touch-LCD-2, Bench's firmware):** each `obj:set{}` costs ~0.1-0.15 ms
  (0.3-0.6 before its firmware of 2026-11-06), and LVGL repaints everything under whatever changed:
  on the earlier firmware a flame of 25 moving gradient ovals over three translucent glow ovals ran
  at 3.4 fps (12 once the glow was opaque and still), and the same flame drawn row by row with
  `lgfx`, redrawing only where it moved, at 28. For many moving shapes use `lgfx`; for LVGL, few
  objects, opaque ones, and leave big ones still.
- **What holds 30 fps with LVGL** (measured on the Guition 4848S040, 480×480, and the S3-Touch-LCD-2,
  240×320, with Patterns: from 6.5-11 fps to 32-33 on the Guition, and from 16-33 to 33 on the S3):
  - **One Anim per pattern or screen, not one per object**, and move everything from it by the clock,
    at most every 30 ms. LVGL's timer can come every 15 ms, and each Anim runs Lua each time.
  - **Reuse one table for `obj:set(p)`.** A table a call cost 739 µs against 278 on the Guition, and
    its garbage makes the long pauses. Skip the call when the rounded value hasn't changed.
  - **No `transform_scale` or `transform_rotation` on anything that moves, or that sits under what
    does.** It draws the object into a layer and transforms that, each repaint (~40 ms for one 68 px
    circle on the Guition; 72 objects: 3.5 fps). Layers nested in layers can **overflow the stack and
    reboot the board** (`Stack canary watchpoint triggered (loopTask)`), and on firmware before
    2026-11-05 so did those 72. Change `w` and `h`, or `transform_width` and `transform_height`, which
    grow the box each way with no layer. For a turned shape, a thick `Line` needs no layer at all.
  - **No `align` on an object whose size changes:** it costs 3× as much (13 against 41 updates a
    second for 16 small objects). Place it by `x` and `y`. Also `clear_flag(lvgl.FLAG.SCROLLABLE)`
    on a parent that never scrolls: ~10%.
  - **A long `Line` is the most expensive thing on screen.** LVGL draws every segment whenever anything
    touches its bounding box, so one orbit of 48 segments under a moving dot cost ~50 ms a frame.
    Split it into short `Line`s (12 of 4 segments): only those under the change redraw.
  - **Turn an `Arc` by `start_angle` and `end_angle`, not `rotation`,** which repaints the whole ring;
    its ends repaint only where they moved. Every arc under a repainted area is masked again, even
    where it shows nothing there, so concentric arcs lose their track (`arc_opa = 0` on `MAIN`) and
    round ends (`arc_rounded = 0`): that alone took five rings from 21 fps to 32 on the Guition.
  - **Stay under 32 changed areas a frame.** Past that LVGL repaints the whole screen. A `set` of one
    size or position marks up to 2, of `y` and `h` together up to 4, so 16 objects can tip it over
    (4.8 fps on the Guition). Change one property per object, and past ~14 objects take turns.
  - **Share a `lvgl.Style` among objects that look the same.** `style:set` is 4× cheaper than a
    `set` (105 µs against 479) and covers them all, but **it repaints nothing**: call `obj:invalidate()`
    on each. Keep Styles for the life of the app and reuse them.
  - **To change little of something tall, leave it still.** An object repaints whole when it changes,
    so an equaliser's bar is a still gradient under opaque covers in the background's colour, in fixed
    sections, and only the cover at the level changes.
  - **Costs on a board, per call:** Guition / S3-LCD-2: `set` of translate (same table) 109 / 95 µs,
    `w, h` 170 / 136, `bg_opa` 134 / 96, arc's two angles 201 / 173, `style:set` 67 / 65,
    `math.sin` + `math.cos` 31 / 29. Lua's maths is cheap on an S3; LVGL's calls and repaints aren't.
    (Both with their firmware since 2026-11-06; before, the Guition's cost 2.5-4 times as much and
    the S3's about twice.)
  - **The firmware only gets an untuned screen part of the way.** With the Guition's firmware since
    2026-11-06, Patterns as it was before these rules runs at 29 passes a second on Orbits, 22 on
    Bars, 14.5 on Spinner and 10.5 on Rings (it was 6.5-11 on all of them), and as it is now at 57-62.
    On the S3-LCD-2, with half the pixels, the same four run at 42, 48, 45 and 34 (they were 16, 29,
    34 and 27), and as it is now at 60-65.
  - **A saved app that crashes the board twice in a row isn't loaded again** on Bench's firmware: the
    screen says "Saved app crashed" and the board stays connected. Push a fixed one; a reset or power
    cycle tries the saved one again. An ordinary Lua error never gets that far.
- **Calls that go through C can only nest so far.** Plain Lua recursion is fine, but each `pcall`,
  metamethod (`__index` as a function) or callback from C (`string.gsub`, `table.sort`) takes board
  stack. Lua's own limit is 200, which is what Bench has. On Bench's S3 boards it's 25, then the error
  `C stack overflow`, and on boards without PSRAM (C6-LCD-1.47, e-paper) there's no limit that fits: about
  9 levels of `pcall` **panics the board and reboots it**. A recursive `__index` is the usual way there.
- **Don't clear what didn't change, with `screen` or `lgfx`, where a flip sends pixels** (the
  S3-Touch-LCD-2, the XIAO, the C6, and the Guition's firmware before 2026-11-06). `screen.clear` or
  `fillScreen` marks every tile, so `flip()` pushes the whole frame: 30.5 ms on that Guition, whatever
  moved. Bounce, Accel and Tilt ball went from 13-17 fps to 30 there by painting over only where the
  thing was, and the Swiss clock by drawing only when its second changes. A strip picture repaints
  only around its edge (Water Sim: 12 to 29 fps). When every pixel really changes, flip part of it
  each tick, in bands at least 16 px wide (Rainbow: 8.5 to 30 flips a second, each band at 15).
  With the Guition's firmware since 2026-11-06 a flip copies nothing, and clearing and redrawing all
  of 480×480 runs at the tick's 30 fps (an every-pixel Rainbow too); drawing less is still less work.
- **A `Line`'s points in its parent's coordinates give it a box from the parent's origin to its furthest
  point**, and it repaints all of that. Place it at the corner of its points (Little devil: 6.4 to 27-29 fps).
- **Reading LVGL back on a board:** an object has `.w` and `.h`, and `get_coords()` and `get_pos()`, as
  LVGL's last pass laid it out: a new or changed label reads 0 or its old size until then. There is no
  `get_width`, `get_height`, `get_x`, `get_y`, `has_flag` or `has_state`, and reading a property that
  doesn't exist is an error, `property not found`, not nil. To measure text now, keep a hidden label:
  `ruler:set { text = t }`, `ruler:align_to { base = ruler:get_parent(), type = lvgl.ALIGN.TOP_LEFT }` (it
  lays out at once, and its `base` is required), then `ruler.w`. Bench does all of this as a board does.
- **Faster than a 10 Hz `on_tick` with `lgfx`:** `lvgl.Timer` runs at ~30 fps on boards with `lvgl`. Bind
  LVGL first and `lgfx` last (the last bind owns the screen; the timer keeps running), and fall
  back to `on_tick` where `lvgl` is nil.
- **Stiff springs at 10 Hz:** a spring that's stable at 30 fps can blow up at a 100 ms tick (and
  `dt_ms` can be that long on any board when a tick overruns). Step
  it in 10 ms slices inside `on_tick`.
- **Measure on the board:** log the average `dt_ms` over 30 ticks (`log.info`) and read the
  board's serial output. ~100 means the board keeps up; more means it's falling behind.

## On a real board (Bench's Mirror)

Bench's Real device panel pushes the open app to a Resident device and drives it from the bench:

- The app travels wrapped in a small shim (only the stand-ins it uses, minified) that defines
  `dial`, `trigger`, `light`, `pir`, `climate`, `touch`, `switch`, `joystick`, `keypad`, `ir`, `rfid`,
  `mic`, `tof`, `thermal`, `co2`, `pulse`, `ld2410`, `imu`, `touchscreen` and a silent `buzzer` where
  the firmware has none, fed by `bench` events from Bench. Write against the API and it runs
  unchanged: the readings (the IMU's rotation rate included) and the driver events arrive as they do
  in Bench. A sensor's events (a key, a tag, a clap, a beat, `motion`, `touch` …) reach an app with
  an `on_event` in the order Bench raised them, each once, and each trigger press carries its own `code`.
- An update is at most 1 KB, so arrays travel packed (the thermal camera's 64 pixels in 128
  characters, the pulse sensor's 32-sample FIFO) and only the readings of modules the app names go.
  Past 1 KB the biggest readings are left out first, taking turns; the board keeps the last of each.
- Buttons A and B: the taps and holds Bench recognises are replayed on the board. Touches on Bench's
  screen are replayed the same way, in order with their points. The board's own keys and touch
  panel still work while Bench mirrors: a press on the real board always reaches the app. Bench
  doesn't see those, so after one the two screens can differ. `button.press_count()` and a tap's
  `count` add up the taps from both.
- E-paper: the real panel refreshes in the background, newest frame wins, exactly as Bench shows it.
- Local time: Bench sends its time zone before each app, so `datetime.now()` reads the same on both
  screens on boards running Bench's firmware. Other firmware stays on UTC.
- An app the board can't load (out of memory, a module it lacks) leaves the previous app on screen:
  Bench only knows the relay took it. Bench's App menu lists only the apps that fit the chosen board,
  and says why the others won't run.

## Share links: open an app in Bench

A share link opens an app in anyone's Bench on the hardware it was written for: the output, the
board, the parts on the bench and what each control is connected to. When an app is done, give the
user one as well as the file. A link the user pastes tells you their setup. There are two kinds:

```
https://bench.porous.systems/#share=1.<data>     a long link: the setup itself, after the #
https://bench.porous.systems/s/<id>              a short link: the setup stored on Bench's server
```

`<data>` is the setup as JSON, compressed with raw DEFLATE (no zlib header), in base64url without
padding. A long link never reaches a server (browsers don't send the part after `#`), but with an
app's code in it runs to thousands of characters. With Node, from the app's file:

```sh
node -e '
const fs = require("fs"), zlib = require("zlib");
const setup = {
  output: { kind: "display", device: "waveshare-esp32-c6-lcd-1.47" },
  board: "waveshare-esp32-c6-lcd-1.47",
  parts: [{ id: "knob-1", kind: "knob", label: "Speed" }, { id: "button-1", kind: "button", label: "Fire" }],
  connections: { speed: "knob-1:rotate", fire: "button-1:press" },
  app: { name: "flame", code: fs.readFileSync("flame.lua", "utf8"), description: "A flame the knob fans" },
};
console.log("https://bench.porous.systems/#share=1." + zlib.deflateRawSync(JSON.stringify(setup)).toString("base64url"));
'
```

For a short link, which fits anywhere (a LinkedIn post holds 3,000 characters, link included),
send the data, everything after `#share=`, to Bench, and put the id it answers after `/s/`:

```sh
curl -s https://bench.porous.systems/api/share --data-binary "1.<data>"   # {"id":"Xk3f9aQ2pL7d"}
```

Bench keeps only setups it can open, up to 90,000 characters of data, and 30 an hour from one
address. The id comes from the setup's hash, so the same setup always gets the same link and no one
can change what a link opens; anyone with the link can open it. The Share button makes short links.

To read a link: for a short one, `curl -s https://bench.porous.systems/api/share/<id>` gives its
data; then `zlib.inflateRawSync(Buffer.from(data.slice(2), "base64url"))`, where `data` is
everything after `#share=` (`1.` and the rest).

- `output`: `{ kind: "display", device }` with a `device` from the table below; `{ kind: "strip",
  count }` with 8, 16, 30, 60 or 144 LEDs; `{ kind: "ring", count }` with 12, 16 or 24;
  `{ kind: "matrix", w, h }` at 8×8, 16×16 or 32×8.
- `board`: one that drives that output (below). Modules with their own chip have just the one.
- `parts`: what the user puts on the bench, `{ id, kind, label }`, with ids `<kind>-<n>` (`knob-1`,
  `button-2`). Leave out the board's own buttons, IMU, buzzer and microphone: they come with the board.
- `connections`: each of the app's dials and triggers, by the name given to `dial.new` or
  `trigger.new`, to `"part:channel"` or `"none"`. `{}` leaves it to the app's `connect` and `via`
  options, as when the app is opened any other way. The board's own parts are `builtin-button-0`
  (A), `builtin-button-1` (B), `builtin-imu`, `builtin-buzzer` and `builtin-mic` (the M5StickC Plus2
  and the ESP-Mosaico), on boards that have them.
- `app`: `{ name, code, description? }` for an app you wrote; `{ bundled: "<id>" }` for one of
  Bench's own (its file name in `src/resident-apps`, less `.lua`).

| Display | `device` | `board` |
|---|---|---|
| M5StickC Plus2 | `m5stickc-plus2` | `m5stickc-plus2` |
| M5StickS3 | `m5sticks3` | `m5sticks3` |
| Waveshare ESP32-C6-LCD-1.47 | `waveshare-esp32-c6-lcd-1.47` | `waveshare-esp32-c6-lcd-1.47` |
| Waveshare ESP32-S3-Touch-LCD-2 | `waveshare-esp32-s3-touch-lcd-2` | `waveshare-esp32-s3-touch-lcd-2` |
| Waveshare ESP32-S3-Touch-AMOLED-1.32 | `waveshare-esp32-s3-touch-amoled-1.32` | `waveshare-esp32-s3-touch-amoled-1.32` |
| Waveshare ESP32-S3-AMOLED-1.91 | `waveshare-esp32-s3-amoled-1.91` | `waveshare-esp32-s3-amoled-1.91` |
| Waveshare ESP32-S3-Touch-AMOLED-1.91 | `waveshare-esp32-s3-touch-amoled-1.91` | `waveshare-esp32-s3-amoled-1.91` |
| Seeed Studio Round Display for XIAO | `seeed-xiao-round-display` | `seeed-xiao-esp32s3-round-display` |
| Guition ESP32-S3-4848S040 | `guition-esp32-s3-4848s040` | `guition-esp32-s3-4848s040` |
| Espressif ESP-Mosaico | `espressif-esp-mosaico` | `espressif-esp-mosaico` |
| 1.3" ST7789 240×240 | `generic-st7789-240x240` | a dev board |
| SSD1306 OLED 128×64 | `ssd1306-128x64` (yellow/blue: `ssd1306-128x64-yellow-blue`) | a dev board |
| SSD1306 OLED 128×32 | `ssd1306-128x32` | a dev board |
| 2.13" e-paper | `waveshare-epd-2.13-v4` | `waveshare-esp32-epaper-driver` or `esp32-s3-devkitc-1-n16r8` |

The dev boards, for bare modules and every LED output: `esp32-s3-devkitc-1-n16r8` (the default),
`esp32-devkitc` and `seeed-xiao-esp32s3`.

A dial connects to a channel that turns or measures, a trigger to one that fires:

| Part `kind` | Dial channels | Trigger channels |
|---|---|---|
| `button` | | `press` |
| `switch` (toggle or reed switch: held while on) | | `on` |
| `knob` (rotary encoder) | `rotate` | `push` |
| `pot` (slide pot) | `position` | |
| `joystick` | `x`, `y` | `press` |
| `touch` (touch pad) | | `touch` |
| `keypad` (12 keys) | | `any`, `1`, `2`, `3`, `4`, `5`, `6`, `7`, `8`, `9`, `star`, `0`, `hash` |
| `ir` (receiver and the kit's remote) | | `any`, `up`, `left`, `ok`, `right`, `down`, `1`, `2`, `3`, `4`, `5`, `6`, `7`, `8`, `9`, `star`, `0`, `hash` |
| `rfid` (reader and its tags: held while one lies on it) | | `tag`, `card-a`, `card-b`, `fob`, `sticker` |
| `imu` | `tilt-x`, `tilt-y` | `shake` |
| `mic` | `level` | `clap` |
| `ld2410` (radar) | `distance` | `presence` |
| `tof` (distance, 0–1.2 m) | `distance` | `near` |
| `thermal` (8×8 thermal camera) | `hot-x`, `hot-y` | `warm` |
| `light` | `level` | `dark` |
| `pir` | | `motion` |
| `climate` | `temperature`, `humidity` | |
| `co2` (400–2000 ppm) | `co2` | `stuffy` |
| `pulse` (40–180 bpm) | `bpm` | `beat`, `finger` |
| `buzzer` | | |

Opening a link replaces the setup in that browser, and Bench offers **Back to my bench** until the
user keeps the new one. An id that Bench doesn't know is left out and named.

## Lua modules

### lgfx (preferred)

```lua
local g = lgfx.bind("main")
g:fillScreen(0x000000)
g:setTextColor(0xFFFFFF); g:setTextSize(2); g:setTextDatum(lgfx.MC_DATUM)
g:drawString("hi", g:width() // 2, g:height() // 2)
g:flip()                          -- nothing is visible until flip
```

Two more on Bench's boards, from Bench's Resident (fork `59cd3cf`; upstream's sheet doesn't have them):

```lua
g:pushImage(x, y, w, h, rgb565)           -- w*h*2 bytes, big-endian RGB565, row by row
g:pushImage(x, y, w, h, idx, palette[, t]) -- w*h bytes, each an index into palette (1-256 colours,
                                           -- 2 bytes each, big-endian RGB565); index t isn't drawn
g:setClipRect(x, y, w, h)  g:clearClipRect() -- nothing drawn outside it until cleared
```

An image goes straight into the frame, far faster than drawing it a pixel or a rect at a time: a
backdrop and sprites over it (palette images with a transparent index), redrawn in a clipped
region, is the way to animate a full scene. The clip holds for every lgfx and `screen` call, not
LVGL's, and each app starts without one. On e-paper, images ink by the 1-bit rule like everything else.

Full sheet: Resident's `prompts/lgfx.md`. Integer arguments are checked like `luaL_checkinteger`:
`g:fillRect(1.5, …)` raises, so `math.floor` computed coordinates.

On Bench's boards `lgfx` draws through Adafruit GFX, and Bench draws as it does: its classic 6×8
font, one glyph per byte, so text is ASCII (a UTF-8 "°" prints as two odd glyphs; `"\xF7"` is the
font's degree sign). `drawString` places the text by its datum at 6 px a character, then prints
it: the cursor ends after it, and a `"\n"` starts a line at x = 0.

### screen (M5Stick verbs, 0–255 channels)

```lua
screen.clear([r, g, b])                       -- default black
screen.text(x, y, str[, size = 2[, r, g, b]]) -- default white
screen.fill_rect(x, y, w, h, r, g, b)    screen.rect(x, y, w, h, r, g, b)
screen.line(x0, y0, x1, y1, r, g, b)     screen.pixel(x, y, r, g, b)
screen.triangle(x0, y0, x1, y1, x2, y2, r, g, b)
screen.fill_triangle(x0, y0, x1, y1, x2, y2, r, g, b)
screen.qr(x, y, text[, scale = 4[, r, g, b]])  -- QR v3..v10, ECC low
screen.flip()   screen.set_brightness(0..255)   screen.width()   screen.height()
```

`screen` and `lgfx` draw into the same frame buffer.

### imu, buzzer, button

```lua
local ax, ay, az = imu.accel()
local gx, gy, gz = imu.gyro()
buzzer.beep(440, 200)   buzzer.tone(1000)   buzzer.stop()
button.press_count()    -- taps since the app loaded
```

### dial, trigger, ld2410 (Bench drivers)

Declare these at the top of the app (or in `init`): each declaration puts the part on the desk.
Which hardware drives a dial or trigger is the user's choice in Bench's Connections panel, so write
against the API, not a specific part: use `via` for the kind of hardware, and `connect` only when the
app is written for one particular bench.

```lua
local speed = dial.new("speed", { min = 1, max = 10, step = 1, start = 3 })
--   options: label, min, max, step, start, wrap,
--            via = "encoder" | "pot" | "joystick-x" | "joystick-y" | "imu-x" | "imu-y" | "radar" | "distance"
--                | "heat-x" | "heat-y" | "light" | "sound" | "temperature" | "humidity" | "co2" | "pulse",
--            connect = "pot-1:position" (one specific part and channel, as Connections names them),
--            keys = { down = "ArrowLeft", up = "ArrowRight" }
speed:value()   speed:delta()   -- steps since the last call   speed:fraction()   -- 0..1 in the range

local fire = trigger.new("fire", { key = "Space" })
--   options: label, key (a KeyboardEvent.code), connect = "button-1:press",
--            via = "button" | "external-button" | "switch" | "encoder-push" | "joystick-press" | "touch"
--                | "keypad" | "ir" | "rfid" | "shake" | "presence" | "near" | "warm" | "motion" | "dark"
--                | "clap" | "stuffy" | "heartbeat" | "finger",
--            code = "ok" (on a part with several keys or tags, the one to ask for by its id: "5", "ok", "star", "card-a"; any other is an error)
fire:is_pressed()   fire:was_pressed()   fire:was_released()   fire:pressed_for(ms)
fire:code()         -- what the latest press carried: the key ("5", "ok") or the tag's UID; nil for a plain press

ld2410.begin({ mode = "wander" })   -- "wander" | "approach" | "empty" | "manual"
local r = ld2410.read()  -- { connected, moving, still, distance_cm, moving_cm, moving_energy, still_cm, still_energy, out }
```

Driver events arrive in `on_event` with `e.channel == "driver"`: `dial` `{ name, value, delta }` when a
dial moves, `trigger` `{ name, pressed, code }` on each edge (`code` on a press from a keypad, the
remote or a tag), `presence` `{ moving, still, distance_cm }` when the radar's state changes. A switch
reads `is_pressed()` for as long as it's on. Poll in `on_tick` or react to events, whichever reads better. These
modules exist only on Bench (or a board whose firmware provides them); guard with `if dial then`
for apps that should also run on a plain M5Stick.

### light, pir, climate, touch (Bench drivers)

```lua
light.read()    -- { level = 0..1, lux = 1..10000, raw = 0..4095 }   light.level()
pir.read()      -- { motion = bool }                                  pir.motion()
climate.read()  -- { temperature = °C, humidity = % }                 climate.temperature(), climate.humidity()
touch.read()    -- { touched = bool, raw = touchRead() }              touch.touched()
```

The first read puts the sensor on the user's bench if it isn't there. PIR and touch also send driver
events, whether or not the app reads them: `motion` `{ moving }` and `touch` `{ touched }` on each change. Prefer a `dial`/`trigger`
(`via = "light"`, `"temperature"`, `"motion"`, `"touch"` …) when the app only needs "a value" or "a
press": the user can then connect any part to it.

### switch, joystick, keypad, ir, rfid (Bench drivers: things you flip, push, press and lay down)

```lua
switch.read()     -- { on = bool }                                        switch.on()
joystick.read()   -- { x, y = -1..1 (right, away: +), pressed, raw_x, raw_y = 0..4095 }   joystick.x(), .y(), .pressed()
keypad.read()     -- { keys = { "1", "5" } (touched now), last, mask = 12 bits: 1-9, star, 0, hash from bit 0 }   keypad.pressed("5")
ir.read()         -- { key (held now, or nil), last, code (its NEC command), address }   ir.key()
rfid.read()       -- { present = bool, uid = "04A3B2C1", type = "mifare-classic" | "ntag" }   rfid.uid()
```

- **switch**: a toggle or a reed switch (a magnet on a door or lid). Event `switch` `{ on }`.
- **joystick** (KY-023): centred where it rests, with a small dead zone. Event `stick` `{ dir }` each
  time it's pushed past halfway another way: `"left"`, `"right"`, `"up"`, `"down"`, `"center"`, as a d-pad.
- **keypad** (MPR121, 12 capacitive pads in a phone's layout: `1`–`9`, `star`, `0`, `hash`): several at
  once. Event `key` `{ key, pressed }` for every pad touched and let go.
- **ir** (VS1838B and the kit's 17-key remote, NEC address 0x00): a key goes down 67 ms after it's
  pressed (its frame), stays down while the remote repeats, and comes up 120 ms after the last
  repeat (up to ~130 ms after it's let go). One key at a time. Event `ir` `{ key, code, address, held }` for every frame, the repeat codes too
  (`held = true`: the key is still down), so a held key can step a volume. Keys: `up`, `down`, `left`, `right`, `ok`,
  `1`–`9`, `star`, `0`, `hash`.
- **rfid** (PN532): a tag lying on the reader, found at its next poll (every 100 ms). Event `tag`
  `{ present, uid, type }` as one comes and goes. Bench's tags are two cards, a key fob and an NTAG
  sticker; a real reader reads any card's UID, so learn them (store the ones you've seen) rather than
  writing Bench's into the app.

A trigger on one of these is the simplest way in: `trigger.new("next", { via = "ir", code = "right" })`,
or `{ via = "keypad" }` for any key with `next:code()` saying which.

### mic, tof, thermal, co2, pulse (Bench drivers: sensing)

```lua
mic.read()      -- { level = 0..1 (30–100 dB), db = dB SPL, bands = { 8 × 0..1 } }   mic.level(), mic.db()
tof.read()      -- { mm = 40..4000 (nil out of range), status = "ok" | "out of range" }   tof.mm()
thermal.read()  -- { pixels = { 64 × °C }, thermistor, max, warm = bool, hot_x, hot_y = 0..7 }   thermal.pixels()
co2.read()      -- { co2 = ppm, temperature, humidity } (empty in its first 5 s)   co2.ppm()
pulse.read()    -- { finger = bool, bpm (nil until it has a rate), ir, red }   pulse.bpm()
pulse.samples() -- the IR samples since the app last asked (100 a second, at most 32)
```

- **mic** (INMP441, or the board's own on the M5StickC Plus2 and the ESP-Mosaico): the level from
  512-sample blocks at 16 kHz (32 ms each), and 8 octave bands from 63 Hz to 8 kHz, each 0..1 over
  20–90 dB. Event `clap` `{ db }`: a sharp sound over 1 kHz, 15 dB above the background. For an LED
  visualiser, map `bands` across the strip in `leds.on_frame`.
- **tof** (VL53L1X): a new reading every 50 ms, a few mm of noise. Event `near` `{ near, mm }` as
  something comes within 30 cm and goes.
- **thermal** (AMG8833): 8×8 pixels, row by row as the sensor sees the scene, 0.25 °C steps, 10
  frames a second over a 60° view. `warm` when something is 3 °C over the room (a hand, a face); `hot_x`,
  `hot_y` are where it is. Event `warm` `{ warm, x, y }`. On an 8×8 matrix, one LED a pixel.
- **co2** (SCD41): a measurement every 5 s, the first 5 s after it starts; ~420 ppm is outdoor air,
  over 1000 a room to air. Event `co2` `{ co2, temperature, humidity }` with each measurement: redraw
  an e-paper display then, not every tick.
- **pulse** (MAX30102): a fingertip resting on it. It needs a few seconds of steady beats before
  `bpm` is set. Events `finger` `{ on }` and `beat` `{ bpm }` with each heartbeat once it has a rate.
  Read `pulse.samples()` at least every 300 ms or the FIFO loses some. For showing a pulse, not for
  anything medical.

Their events reach `on_event` whether or not the app reads the module, as a real board's drivers'
do: an app that only handles `ir` or `key` events needs no read. Reading one that isn't on the bench
puts it there.

### touchscreen (Bench driver, displays with a touch panel)

Only on a display with a touch panel (the Waveshare ESP32-S3-Touch-LCD-2,
ESP32-S3-Touch-AMOLED-1.32 and ESP32-S3-Touch-AMOLED-1.91, the
Seeed Studio Round Display for XIAO, the Guition ESP32-S3-4848S040 and the Espressif ESP-Mosaico); elsewhere `touchscreen` is nil, so check
`if touchscreen then` or tag the app `-- @needs touch`. One finger, in the coordinates the app
draws in. In Bench the user taps and drags on the screen with the mouse.

```lua
local t = touchscreen.read()   -- { pressed = bool, x, y }: the last point touched
touchscreen.pressed()
-- on_event(ctx, e), e.channel == "driver", e.data = { x, y }:
--   "touch_down", "touch_move" (the newest point, at most once a loop), "touch_up",
--   "touch_tap"  after touch_up, for a release within 500 ms that moved under 10 px
```

LVGL widgets don't receive touches: hit-test your own layout.

### leds (Bench driver, LED outputs)

When the user picks an LED strip, ring or matrix as the output (instead of a display), the board
drives a WS2812B chain. Start the file with `-- @output strip` (strips and rings) or
`-- @output matrix` so it's listed for that output.

```lua
leds.count()  leds.width()  leds.height()  leds.xy(x, y)   -- LEDs from 0 in chain order; xy finds one on a matrix
leds.set(i, 0xRRGGBB)  leds.set_rgb(i, r, g, b)  leds.get(i)  leds.fill(c[, from[, count]])  leds.clear()
leds.hsv(hue_degrees, s, v) -> colour     leds.brightness(0..255)     leds.show()   -- nothing lights until show
leds.on_frame(function(ctx, dt_ms) ... end[, fps])   -- the LED driver's frame timer, default 50 fps
```

Put continuous effects in `on_frame` (on_tick is only 10 Hz). Keep brightness modest (~100): full
white is ~60 mA an LED. On a matrix, always find an LED with `leds.xy(x, y)`, never `y * width + x`:
the chain runs through the grid as the panel is wired, and Bench wires each size as those panels
usually are (8×8 row by row; 16×16 serpentine rows, every other one right to left; 32×8 serpentine
columns, down the first and up the next), so an app that computes the index scrambles there, as on
the real panel. A matrix is also an `lgfx` display (8 pixels tall on an 8×8, the built-in
5×7 font fits), so text and shapes work with `lgfx.bind("main")` and `g:flip()`.

Plus every universal module from Resident's `prompts/sandbox.md`: `log`, `events`, `store`,
`time`, `datetime` (local zone = the browser's), `screens`.

### lvgl (optional; only on boards with LVGL)

LVGL 9 through luavgl, per Resident's `prompts/lvgl.md`. `lvgl.bind("main")` returns the display
handle and claims the panel (`lgfx` flips are then dropped: one library per panel). Fonts: the
`montserrat` family at 8, 14, 16, 20, 24, 28, 32, 36, 40 and 48 px (`lvgl.Font("montserrat", 20)`;
other sizes snap to the nearest). Put continuous motion in `lvgl.Anim`: LVGL's timer pump runs every
33 ms, `on_tick` only every 100. An anim needs an `exec_cb` (starting one without fails with "anim has
no exec_cb"), and its `done_cb` runs only when it plays to its end, not on `stop()` or a restart. A
`lvgl.Timer` whose `repeat_count` runs out pauses: `set { repeat_count = n }` and `resume()` run it
again. Bench draws `Object`, `Label`, `Button`, `Arc`, `Line`, `Led` and
`Checkbox` faithfully. `Roller` is simplified, and `Image`, `Dropdown`, `Textarea`, `Scale`, `List`,
`Keyboard` and `Calendar` are placeholder boxes, so prefer the first set. No widget receives input
events.

## Example

```lua
local g = lgfx.bind("main")
local s = screens.get("main")
local bg = s.scheme == "light" and 0xFFFFFF or 0x000000
local fg = s.scheme == "light" and 0x000000 or 0xFFFFFF
local n = 0

local function draw()
  g:fillScreen(bg)
  g:setTextColor(fg); g:setTextSize(2); g:setTextDatum(lgfx.MC_DATUM)
  g:drawString("taps " .. n, g:width() // 2, g:height() // 2)
  g:flip()
end

function init(ctx) draw() end
function on_event(ctx, e)
  if e.name == "tap" then n = n + 1; buzzer.beep(880, 40); draw() end
end
```

## Validation stubs

```lua
screen = setmetatable({
  width = function() return 240 end,
  height = function() return 135 end,
}, { __index = function() return function() end end })
imu = setmetatable({
  accel = function() return 0, 0, 1 end,
  gyro = function() return 0, 0, 0 end,
  temp = function() return 0 end,
}, { __index = function() return function() end end })
button = setmetatable({ press_count = function() return 0 end }, { __index = function() return function() end end })
local handle = setmetatable({}, { __index = function() return function() return 0 end end })
dial = { new = function() return handle end }
trigger = { new = function() return setmetatable({}, { __index = function() return function() return false end end }) end }
ld2410 = { begin = function() end, read = function()
  return { connected = true, moving = false, still = false, distance_cm = 0, moving_cm = 0, moving_energy = 0,
           still_cm = 0, still_energy = 0, out = false }
end }
buzzer = setmetatable({}, { __index = function() return function() end end })
light = { read = function() return { level = 0.5, lux = 300, raw = 2048 } end, level = function() return 0.5 end }
pir = { read = function() return { motion = false } end, motion = function() return false end }
climate = { read = function() return { temperature = 21, humidity = 40 } end,
  temperature = function() return 21 end, humidity = function() return 40 end }
touch = { read = function() return { touched = false, raw = 0 } end, touched = function() return false end }
touchscreen = { read = function() return { pressed = false, x = 0, y = 0 } end, pressed = function() return false end }
switch = { read = function() return { on = false } end, on = function() return false end }
joystick = { read = function() return { x = 0, y = 0, pressed = false, raw_x = 2026, raw_y = 2026 } end,
  x = function() return 0 end, y = function() return 0 end, pressed = function() return false end }
keypad = { read = function() return { keys = {}, mask = 0 } end, pressed = function() return false end }
ir = { read = function() return { address = 0 } end, key = function() return nil end }
rfid = { read = function() return { present = false } end, uid = function() return nil end }
mic = { read = function() return { level = 0.14, db = 40, bands = { 0, 0, 0, 0, 0, 0, 0, 0 } } end,
  level = function() return 0.14 end, db = function() return 40 end }
tof = { read = function() return { mm = 250, status = "ok" } end, mm = function() return 250 end }
local px = {} for i = 1, 64 do px[i] = 22 end
thermal = { read = function() return { pixels = px, thermistor = 23.5, max = 22, warm = false, hot_x = 3.5, hot_y = 3.5 } end,
  pixels = function() return px end }
co2 = { read = function() return { co2 = 650, temperature = 22, humidity = 45 } end, ppm = function() return 650 end }
pulse = { read = function() return { finger = false, ir = 2000, red = 1500 } end, bpm = function() return nil end,
  samples = function() return {} end }
screens = { get = function()
  return { name = "main", w = 240, h = 135, shape = "rect", depth = 16, scheme = "dark", brightness = 1,
           model = "M5StickC Plus2", controller = "ST7789V2", tech = "lcd" }
end }
local gfx = setmetatable({ width = function() return 240 end, height = function() return 135 end },
  { __index = function() return function() return 0 end end })
lgfx = setmetatable({ bind = function() return gfx end }, { __index = function() return 0 end })
leds = setmetatable({ count = function() return 30 end, width = function() return 30 end, height = function() return 1 end },
  { __index = function() return function() return 0 end end })
```
