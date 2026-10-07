# porous.systems Bench

**A workbench in the browser for ESP32 hardware: an output (a small LCD, OLED or e-paper display,
or a WS2812 LED strip, ring or matrix) and the buttons, knobs and sensors you wire to it, laid out
on a desk.** Apps are Lua, written
for [Resident](https://github.com/inanimate-tech/resident)'s runtime: try animations, fonts and UI
ideas without flashing hardware, switch the display under your code with one click, and push the same
app to a real device. Bench can also join the Resident relay as a device.

**Try it: [bench.porous.systems](https://bench.porous.systems)**

![Bench running Resident's water-sim app on an M5StickC Plus2](docs/images/app.png)

<table>
  <tr>
    <td><img src="docs/images/lcd-waveshare.png" alt="Plasma pattern on the Waveshare ESP32-C6-LCD-1.47"></td>
    <td><img src="docs/images/oled.png" alt="Fonts and a walking sprite on a yellow/blue SSD1306 OLED"></td>
  </tr>
  <tr>
    <td align="center">Waveshare ESP32-C6-LCD-1.47 · 172×320 ST7789</td>
    <td align="center">0.96″ SSD1306 OLED, yellow/blue glass</td>
  </tr>
  <tr>
    <td><img src="docs/images/epaper.png" alt="LD2410 presence dashboard on a 2.13 inch e-paper"></td>
    <td align="center"><img src="docs/images/ld2410.png" alt="The simulated LD2410 radar panel with its raw UART frame" width="300"></td>
  </tr>
  <tr>
    <td align="center">2.13″ e-paper, partial refreshes and all</td>
    <td align="center">Simulated LD2410 radar, down to the UART bytes</td>
  </tr>
</table>

## Quick start

Requires Node.js 22 or newer.

```sh
git clone https://github.com/sjunnesson/porous-bench.git
cd porous-bench
npm install
npm run dev        # → http://localhost:5199
```

The page has three columns. The **left** column holds the code: pick an **App**, and see its
source, the Resident relay and the console. The **desk** is in the middle. The **right** column holds
the hardware: **Hardware**, where you choose the output and put inputs on the bench, and
**Connections**, where you decide which part drives each of the app's controls. Click a section's
heading to fold it away. Everything you set up (the output, your parts, the connections, where things
sit on the desk, folded sections) is saved in this browser and comes back on your next visit.
Everything runs locally in the browser;
`npm run build` produces a static site you can host anywhere.

## What it does

- **Displays as data.** Each display is one profile file: resolution, technology, controller, bus
  speed, wiring, porting notes and its physical enclosure. Add a file and it appears in the menu.
- **Real constraints.** `show()` takes as long as pushing the changed pixels over the real SPI or
  I2C bus, so frame rates are honest (≈40 fps ceiling on a 400 kHz I2C OLED). E-paper refreshes take
  their real 2 s / 0.3 s, flash on a full refresh and leave ghosting after partial ones.
- **One kind of app: Lua, the Resident way.** `init`, `on_tick` at 10 FPS, `on_event`, drawing with
  `lgfx`. Resident apps run unmodified, and Bench adds drivers for the hardware on its desk.
- **Outputs.** Display modules, or addressable LEDs: a WS2812B strip (8–144 LEDs), a ring (12, 16,
  24) or a matrix (8×8, 16×16, 32×8), glowing in both views and timed on the real 800 kHz one-wire bus.
- **Your bench.** Add and remove inputs: push buttons, a rotary encoder, a slide pot, a touch pad, an
  IMU you tilt and shake, an HLK-LD2410 radar, a PIR motion sensor, a light sensor, a temperature /
  humidity sensor and a buzzer you can hear. The board brings its own (the M5StickC's buttons, IMU and
  buzzer). Each part has a widget and a 3D model on the desk.
- **Connections.** An app declares the controls it needs ("speed", "next"); you connect each one to a
  part on the bench, and can rewire it while the app runs.
- **An app from your bench.** **✦ New app from my bench** writes a Lua app for the output and parts
  you've chosen: a control for every input, connected to its part and shown live, ready to edit.
- **Time control.** Pause, single-step and run at 0.1×–4×. Delays, bus transfers, refreshes and
  sensor data all follow the simulated clock.
- **Two views.** A ghosted 3D wireframe of the actual part, with the live screen on it, or the bare
  glass, flat and pixel-exact, with zoom and a pixel grid.
- **The whole bench in 3D.** Inputs the device doesn't have sit on the desk beside it as parts you
  can use: a rotary encoder (drag the ring, press the centre, scroll), tactile buttons, a slide pot,
  a piezo that pulses while it sounds, and the LD2410 with its detection fan and a little character
  who walks, blinks and looks around; click anywhere to send it walking there, or pick it up by the head to carry it. Each part is wired back
  to the device. With an IMU the device itself tilts and shakes.
- **Hot reload.** Edit an app in the code panel and press Run (⌘↵), drop a `.lua` file on the device,
  or save a bundled one: it restarts in place.

## Displays

| Display | Technology | Resolution | Bus |
|---|---|---|---|
| Waveshare ESP32-C6-LCD-1.47 | IPS LCD, ST7789V3, rounded corners | 172×320 | SPI 80 MHz |
| M5StickC Plus2 | LCD, ST7789V2 | 135×240 | SPI 40 MHz |
| M5StickS3 | LCD, ST7789P3 | 135×240 | SPI 40 MHz |
| Generic 1.3″ IPS | LCD, ST7789 | 240×240 | SPI 40 MHz |
| 0.96″ OLED (white, or yellow/blue) | OLED, SSD1306 | 128×64 | I2C 400 kHz |
| 0.91″ OLED | OLED, SSD1306 | 128×32 | I2C 400 kHz |
| Waveshare 2.13″ e-Paper V4 | E-paper, SSD1680, black/white | 122×250 | SPI 10 MHz |

The Device panel shows each one's controller, RAM offsets, wiring and the things a driver must get
right on hardware (the Waveshare's 34-pixel column offset and INVON, the SSD1306 charge pump, …).

## Writing apps

An app is one Lua file. Pick one in the **App** menu, edit it in the code panel and press Run
(⌘↵), or drop a `.lua` file on the device. The bundled ones live in `src/resident-apps/`; a new file
there appears in the menu, named by its first comment line (`-- Name: what it does`).

```lua
-- Comet: a dot that circles the screen. A changes colour; Speed can be any hardware.
local g = lgfx.bind("main")
local W, H = g:width(), g:height()
local speed = dial.new("speed", { min = 1, max = 10, start = 3 })   -- a rotary encoder by default
local colour, angle = 0xFF8800, 0

function on_tick(ctx, dt_ms)                     -- every 100 ms, with the real dt
  angle = angle + speed:value() * dt_ms / 1000
  g:fillScreen(0x000000)
  g:fillCircle(W // 2 + math.floor(math.cos(angle) * W / 3), H // 2 + math.floor(math.sin(angle) * H / 3), 6, colour)
  g:flip()                                       -- nothing is visible until flip()
end

function on_event(ctx, e)
  if e.name == "tap" and e.data.index == 0 then colour = colour ~ 0xFFFFFF end
end
```

Like the device, `on_tick` runs 10 times a second, so animation runs at 10 FPS; use `dt_ms` for
motion so speeds are right whatever the timing. A tap or other event can redraw between ticks.
Coordinates are checked like `luaL_checkinteger`, so `math.floor` anything computed.

Included, from Bench, all drawn with LVGL and moved by `lvgl.Anim` (see [LVGL](#lvgl-smooth-animation)):
**Hello display** (device facts and a DVD-style bouncing ball; adapts to every display type),
**Patterns** (orbits, rippling tiles, rings, an equaliser, a spinner and a test card), **Characters**
(text sizes and a walking, jumping pixel robot), **Knob menu** (an encoder-driven settings UI whose
highlight slides between rows), **LD2410 radar** (a presence dashboard with gliding markers and bars),
**Little devil** (a cute chibi devil whose mood follows the radar: it naps when nobody's there, gets
curious, schemes, pops up with a "boo!" when you come close and gets cozy if you stay) and **LVGL
motion** (an `Anim` and an `on_tick` dot side by side). For LED strips and rings: **Rainbow chase**,
**Comet**, **Fire** (Fire2012), **Level meter** (a VU bar you can drive from any sensor) and **Night
light** (fades in on motion, brighter in a darker room). For LED matrices: **Scrolling text**, **Life**
and **Plasma**. On e-paper they skip the animation and jump to
each end state, since every refresh is a slow one. From Resident: the Swiss railway clock, water-sim,
daisy, accelerometer and the rest of its M5Stick examples, which draw with `lgfx`.

### Your bench, and connecting it

Set up the hardware first, then connect it:

1. **Hardware → Output**: a display module, or an LED strip, ring or matrix. The App menu then shows
   the apps written for that output.
2. **Hardware → Inputs**: the parts on the bench. **+ Add an input** puts one on the desk (with its 3D
   part, wired to the board); **remove** takes it off. The board's own buttons, IMU and buzzer are
   there too, marked built-in. Your parts stay when you switch apps.
3. **Connections**: the controls the running app declared. Each reads one *channel* of a part on the
   bench; pick it from the list (only channels that fit are offered), choose **Keyboard only**, or
   **add** a part that's missing and connect it in one go.

A `dial` or `trigger` describes what an app needs, not which part provides it:

| Declare | Read | Channels it can connect to |
|---|---|---|
| `dial.new(name, { min, max, step, start, wrap, via, connect, label, keys })` | `d:value()`, `d:delta()` (steps since last read), `d:fraction()` | encoder turn · slide pot position · IMU tilt ←→ / ↑↓ · radar distance · light level · temperature · humidity |
| `trigger.new(name, { key, via, connect, label })` | `t:is_pressed()`, `t:was_pressed()`, `t:was_released()`, `t:pressed_for(ms)` | button press · encoder push · touch · IMU shake · radar presence · PIR motion · light goes dark |

`via` says what to connect to first (`"encoder"`, `"pot"`, `"light"`, `"temperature"`, `"motion"` …);
the first time an app runs, each control connects to a free part that fits, preferring that one (the
board's buttons A and B go to the board's own buttons). After that your choice is remembered per app.
An encoder steps a dial; a pot or a sensor sets it across its range, and `delta()` counts steps either
way, so menu code doesn't care what's turning it. One encoder can turn one dial while its push fires a
trigger. The keyboard keys work whatever the hardware: they move the connected part itself.
`connect = "knob-2:rotate"` asks for one specific part and channel (the ids are the ones Connections
shows); a part the bench only picked for another control (say, Button A on a board without buttons)
is handed over.

### Start from your bench

Once the bench holds what you want to build with, **App → ✦ New app from my bench** writes the Lua
for it and runs it as *My bench*. Every input gets a control connected to its part (`connect = …`)
and its own keys. Each one shows live on the output: a row with a bar on a display (paging through
when they don't all fit), a run of LEDs on a strip or ring, a column on a matrix. Presses are counted,
logged and flashed (and clicked on the buzzer, if there is one). The code is in the editor to change
and Run: keep the inputs you need and replace `pressed()` and the drawing with what your app should
do. Change the bench and make it again whenever you like; it's written in the browser, nothing is
sent anywhere.

### Bench drivers

Resident boards add hardware through drivers: a Lua module plus events into `on_event` on the
`driver` channel. Bench's desk has these, on top of the M5StickC Plus2's (`screen`, `imu`, `buzzer`,
`button`). A sensor module an app uses puts that part on the bench if it isn't there yet.

| Module | Events |
|---|---|
| `dial`: as above | `dial` `{ name, value, delta }` when a dial moves |
| `trigger`: as above | `trigger` `{ name, pressed }` on each press and release |
| `ld2410.begin({ mode })`, `ld2410.read()` → `{ connected, moving, still, distance_cm, moving_cm, moving_energy, still_cm, still_energy, out }` | `presence` `{ moving, still, distance_cm }` when the state changes |
| `light.read()` → `{ level, lux, raw }`, `light.level()` | |
| `pir.read()` → `{ motion }`, `pir.motion()` | `motion` `{ moving }` on each change |
| `climate.read()` → `{ temperature, humidity }`, `climate.temperature()`, `climate.humidity()` | |
| `touch.read()` → `{ touched, raw }`, `touch.touched()` | `touch` `{ touched }` on each change |
| `leds`: see [LED outputs](#led-outputs) | |

The LD2410 is simulated at the UART level: the virtual sensor sends real 23-byte report frames at
10 Hz and `read()` parses them. Drag the character around the radar (speed decides "moving" vs
"stationary"), click to send it walking, or let it wander (`mode = "wander"`) or approach.
Presence is held for the module's 5 s "no-one duration". `screens.get("main")` also carries Bench
extras: `model`, `controller` and `tech`.

### LED outputs

Choose **LED strip**, **LED ring** or **LED matrix** as the output and the board drives a chain of
WS2812B LEDs instead of a display. Every `show()` sends the whole chain at 800 kHz (24 bits an LED,
then the latch), so a 144-LED strip tops out near 230 fps. The `leds` module (a Bench driver):

```lua
-- @output strip                                   -- in an app: which output it's written for
local n = leds.count()                             -- also leds.width(), leds.height(), leds.xy(x, y)
leds.on_frame(function(ctx, dt_ms)                 -- the LED driver's frame timer (50 fps default)
  for i = 0, n - 1 do                              -- LEDs count from 0, in chain order
    leds.set(i, leds.hsv(ctx.time_ms / 10 + i * 360 / n, 1, 1))
  end
  leds.brightness(96)                              -- 0..255; full white is ~60 mA an LED
  leds.show()                                      -- nothing lights until show()
end)
```

Also `leds.set_rgb(i, r, g, b)`, `leds.get(i)`, `leds.fill(colour[, from[, count]])` and
`leds.clear()`. `on_frame` runs on the driver's own timer like LVGL's pump, so effects move smoothly
between 10 Hz ticks. A matrix is also an `lgfx` display (`lgfx.bind("main")`, 8 pixels tall on an
8×8), so text and drawing work there too; LEDs are row by row from the top-left. An app's
`-- @output display|strip|matrix` line decides where it appears in the App menu (strip apps run on
rings too).

### How it matches Resident

Bench runs apps in a real Lua 5.4 VM ([wasmoon](https://github.com/ceifa/wasmoon)) with Resident's
sandbox:

- **Lifecycle**: `init`, `on_tick` every 100 ms with real `dt_ms`, `on_event` from an 8-slot ring,
  `ctx.time_ms`. Apps that define no callback are rejected.
- **Sandbox**: no `os`, `io`, `load`, `require` or `debug`. A 2,000,000-instruction budget per callback
  aborts a runaway loop without killing the app; `on_tick` errors are rate-limited like the device.
- **Modules**: `lgfx` (LovyanGFX bindings; nothing shows until `flip()`), the M5StickC Plus2 board
  surface (`screen`, `imu`, `buzzer`, `button`), `screens`, `log`, `events`, `store` (2048-byte budget,
  kept across reloads), `time` and `datetime` (Resident's own Lua source over a ported strftime).
- **Argument checks** behave like `luaL_checkinteger`: `g:fillRect(1.5, …)` raises the same error here
  as on the device.
- **Buttons** produce `tap`, `hold` (500 ms) and `button` events (keys **A** and **B**).

Apps that only use Resident's modules run unchanged on a real device. The Bench drivers (`dial`,
`trigger`, `ld2410`) need a board whose firmware provides them. Not supported yet: 32-bit integer
wrap-around (the VM is 64-bit), the boot countdown.

### LVGL: smooth animation

Resident boards can offer an optional `lvgl` module (LVGL 9 through luavgl) instead of drawing with
`lgfx`, and Bench simulates it. The difference that matters is **who drives the motion**: `on_tick`
runs at 10 Hz, but LVGL has its own timer pump. On the reference board it runs every 33 ms
(`LV_DEF_REFR_PERIOD`), calling `lvgl.Anim` callbacks and `lvgl.Timer`s and redrawing what changed.
So continuous motion belongs in an `Anim`, never in `on_tick`:

```lua
local h = lvgl.bind("main")                      -- bind first: it also claims the panel from lgfx
local dot = h.Object { w = 16, h = 16, radius = lvgl.RADIUS_CIRCLE, bg_color = "#5ac8fa" }
dot:Anim {
  start_value = 0, end_value = h.HOR_RES() - 16, duration = 700, playback_time = 700,
  path = "ease_in_out", repeat_count = lvgl.ANIM_REPEAT_INFINITE,
  exec_cb = function(obj, v) obj:set { translate_x = v } end, run = true,
}
```

**LVGL motion** (in the App menu) runs an `Anim` dot and an `on_tick` dot side by side; measured on
the simulated glass, the first updates about 25 times a second and the second 10.

- **Anims** follow `lv_anim.c`: integer values, the `linear`, `ease_in`, `ease_out`, `ease_in_out`,
  `overshoot`, `bounce` and `step` paths, delay, playback, repeat (`lvgl.ANIM_REPEAT_INFINITE`),
  `early_apply`, `done_cb`, and `start` / `stop` / `set` / `delete`. An Anim whose object was deleted
  drops itself.
- **Widgets**: `Object`, `Label`, `Button`, `Arc`, `Line`, `Led` and `Checkbox` are drawn in LVGL 9's
  light default theme with Montserrat, at the reference board's DPI. `Roller` is simplified;
  `Image`, `Dropdown`, `Textarea`, `Scale`, `List`, `Keyboard` and `Calendar` are placeholder boxes for
  now. Layout covers sizes, `lvgl.PCT`, `lvgl.SIZE_CONTENT`, `align`, `align_to`, translate, rotation
  and flex rows and columns.
- **Styles**: the property vocabulary from Resident's `prompts/lvgl.md`, `h:set_theme{...}`,
  `lvgl.Style` with `add_style` (a later `style:set{}` reaches every object using it), and
  `set_style(props, lvgl.PART.*)`, which updates the object's own style for that part, for example an
  arc's track, indicator and knob. An `Arc` takes `value` within `range = {min, max}` (0–100 by
  default).
- **One panel, one library**: once an app calls `lvgl.bind`, `lgfx` flips are dropped, and the other
  way round.
- **Bus timing**: each refresh sends only the pixels that changed, like LVGL's partial flushes.
- Not yet: widget events (an M5Stick has no touchscreen for LVGL either), images, screen-load
  animations.

### Push apps from your terminal or Claude Code

Press **Connect to relay** in the Resident panel. Bench connects to
`wss://resident.inanimate.tech/devices/sim-xxxxxxxx` the way the firmware does and shows its device ID.
Anything that can push to a Resident device can now push to the browser:

```sh
# Resident's Claude Code plugin
/plugin marketplace add inanimate-tech/agent-plugins
/plugin install resident@inanimate
RESIDENT_DEVICE_ID=sim-xxxxxxxx  /resident:push-app give me a lil guy

# or curl
curl -X POST https://resident.inanimate.tech/devices/sim-xxxxxxxx/send \
  -H 'Content-Type: application/json' \
  -d '{"type":"app","code":"function init(ctx) screen.text(10,10,\"hi\") screen.flip() end"}'
```

Pushed apps, `chunk` patches, `channel:"app"` events, `forget` and the host time zone are handled.
The last app that boots is restored on reload. To have agents write apps for Bench's full surface
(any display, plus `lgfx` and `screens`), pass `--device-skill docs/resident/DEVICE-SKILL.md`.

The device ID is a random secret: anyone who knows it can push apps to your browser while you're
connected. Use **new** in the Resident panel to rotate it.

## Keyboard

| Key | Does |
|---|---|
| A / B | the board's buttons 0 and 1 |
| ← / → / Enter | turn / push the rotary encoder (a dial's keys, unless the app sets others) |
| [ / ] | the knob menu's gauge dial |
| F | fit everything in the 3D view |

In the 3D view everything stands on one desk:

- **Use a part:** click buttons, turn the encoder ring, slide the pot, click the radar floor.
- **Move things:** drag the body of the device or of a part (its board, not its controls) to slide
  it across the desk; the wires follow. ⌥ Option-drag moves anything. Double-click something to put
  it back. Layouts are remembered per device and app. **Tidy** puts every part back in an
  automatic layout chosen to suit the stage's shape (beside the device, or under it on a tall stage).
- **Look around:** drag empty space to orbit; scroll or pinch to zoom towards the cursor; right- or
  middle-drag to pan; double-click empty space to reset the angle and fit everything.
- **Fit:** **Fit all** (or **F**) frames the device, every part and the wires. Until you zoom or pan
  yourself, the view keeps everything fitted as the window resizes or parts are swapped. The **+ / −**
  buttons zoom too.
- **Tilt:** shift-drag the device when the app uses the IMU.

## Add a display

Create `src/sim/devices/<id>.ts` exporting a `DeviceProfile`. `waveshare-esp32-c6-lcd-1.47.ts` is a
complete example.

```ts
import type { DeviceProfile } from './types';

export default {
  id: 'my-oled',
  name: '1.3" OLED 128×64 (SH1106)',
  tech: 'oled',                       // 'lcd' | 'oled' | 'epaper'
  width: 128,
  height: 64,
  controller: 'SH1106',
  bus: { kind: 'i2c', hz: 400_000, i2cAddress: 0x3c },
  porting: ['SH1106 RAM is 132 columns wide: start at column 2.'],
  enclosure: {                        // optional: drawn in the 3D view (mm)
    style: 'pcb',
    body: { w: 35.4, h: 33.5, d: 1.2, r: 1 },
    module: { w: 35.4, h: 24, d: 1.4, r: 0.4, x: 0, y: -2 },
    screen: { x: 0, y: -1 },
    parts: [{ kind: 'header', face: 'front', u: 0, v: 14.5, pins: 4, along: 'u' }],
  },
  look: { activeWidthMm: 29.4, activeHeightMm: 14.7, light: '#eaf4ff', dark: '#000000' },
} satisfies DeviceProfile;
```

Enclosure `parts` can be buttons (`input: n` makes one clickable as the app's n-th button),
ports, pin headers, mounting holes and LEDs, placed on any face of the body.

To add an input type, subclass `SimInput` in `src/sim/inputs/`, export a factory like `button()`, add
a widget in `src/ui/widgets/` with a case in `InputPanel.tsx`, and give Lua a driver for it: bridge
functions in `src/resident/host.ts` and the module in `src/resident/lua/prelude.lua`.

## Project layout

```
src/sim/            simulator core, framework-free
  clock.ts            simulated time: pause, step, speed
  gfx.ts              drawing API          framebuffer.ts   MCU-side buffer + dirty rect
  display.ts          show(): bus timing   panels/          LCD, OLED, e-paper physics
  devices/            one file per display inputs/          button, knob, pot, LD2410, IMU, buzzer
  runner.ts           runs a program       renderer.ts      flat canvas view
  controls/           the bench, dials and triggers          leds.ts   LED strips, rings, matrices
  generate.ts         writes a Lua app for the bench
src/resident/       Lua runtime: wasmoon host, Resident sandbox prelude, Bench drivers, relay, datetime
src/resident-apps/  bundled Lua apps (Bench's examples and Resident's)
src/ui/             React UI; ui/three/ builds the wireframe models from each enclosure
tests/              Vitest: graphics, bus timing, panel physics, LD2410 protocol, Lua sandbox and
                    drivers, every bundled and generated app on every kind of output
docs/resident/      DEVICE-SKILL.md for Resident's agent skills
```

## Development

```sh
npm run dev        # dev server with hot reload
npm test           # unit tests
npm run typecheck  # TypeScript
npm run build      # typecheck + static build into dist/
```

## Credits and license

MIT, see [LICENSE](LICENSE). Resident's `datetime` module and example apps are included under
Resident's MIT license, and the Waveshare panel init values come from Waveshare's demo; see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The visual design follows [duscha.nu](https://duscha.nu)
(IBM Plex, paper ground, one blue, rust for "now"), and the wireframe device view is inspired by the
simulator on [resident.inanimate.tech](https://resident.inanimate.tech).
