# screenSim

**A browser simulator for the small displays you wire to an ESP32: LCD, OLED and e-paper, plus the
buttons, knobs and sensors that drive them.** Try animations, fonts, sprites and UI ideas without
flashing hardware, and switch the display under your code with one click. It also runs
[Resident](https://github.com/inanimate-tech/resident) Lua apps unmodified, and can join the Resident
relay as a device.

**Try it: [screensim.vercel.app](https://screensim.vercel.app)**

![screenSim running Resident's water-sim app on an M5StickC Plus2](docs/images/app.png)

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
git clone https://github.com/sjunnesson/screenSim.git
cd screenSim
npm install
npm run dev        # → http://localhost:5199
```

Pick a **Sketch** and a **Display** in the toolbar. Everything runs locally in the browser;
`npm run build` produces a static site you can host anywhere.

## What it does

- **Displays as data.** Each display is one profile file: resolution, technology, controller, bus
  speed, wiring, porting notes and its physical enclosure. Add a file and it appears in the menu.
- **Real constraints.** `show()` takes as long as pushing the changed pixels over the real SPI or
  I2C bus, so frame rates are honest (≈40 fps ceiling on a 400 kHz I2C OLED). E-paper refreshes take
  their real 2 s / 0.3 s, flash on a full refresh and leave ghosting after partial ones.
- **Two kinds of program.** TypeScript sketches written in an Arduino shape, and Resident Lua apps.
- **Inputs you can poke.** Push buttons, a rotary encoder, a potentiometer, an IMU you tilt and
  shake, a buzzer you can hear, and an HLK-LD2410 presence radar. Each has a widget and keyboard keys.
- **Time control.** Pause, single-step and run at 0.1×–4×. Delays, bus transfers, refreshes and
  sensor data all follow the simulated clock.
- **Two views.** A ghosted 3D wireframe of the actual part, with the live screen on it, or the bare
  glass, flat and pixel-exact, with zoom and a pixel grid.
- **The whole bench in 3D.** Inputs the device doesn't have sit on the desk beside it as parts you
  can use: a rotary encoder (drag the ring, press the centre, scroll), tactile buttons, a slide pot,
  a piezo that pulses while it sounds, and the LD2410 with its detection fan and a little character
  who walks, blinks and looks around; pick it up by the head to carry it somewhere else. Each part is wired back
  to the device. With an IMU the device itself tilts and shakes.
- **Hot reload.** Saving a sketch file restarts it in place.

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

## TypeScript sketches

Drop a file in `src/sketches/` and it appears in the Sketch menu. The drawing API follows
Adafruit_GFX / TFT_eSPI names and colours are RGB565 numbers, so a port to C++ is mostly a matter of
deleting `await`.

```ts
import { colors, defineSketch, dial, hsv565, trigger } from '../sim';

let x = 0;

export default defineSketch({
  name: 'My sketch',
  inputs: {
    // What the sketch needs, not which part provides it. Pick the hardware in the Controls panel.
    fire: trigger({ label: 'Fire', key: 'Space' }),                  // push button by default
    speed: dial({ label: 'Speed', min: 1, max: 10, start: 3 }),       // rotary encoder by default
  },
  setup({ display }) {
    display.fillScreen(colors.BLACK);
    x = 0;
  },
  async loop({ display, inputs, millis, delay, log }) {
    if (inputs.fire.wasPressed()) log('fire!');
    display.fillCircle(x, 40, 6, hsv565(millis() / 10, 1, 1));
    x = (x + inputs.speed.value) % display.width();
    await display.show(); // as long as the real bus transfer takes
    await delay(16);
  },
});
```

### Controls: swap the hardware, keep the code

`dial()` and `trigger()` describe what a sketch needs. In the **Controls** panel each one has a
**via** menu, and you can change it while the sketch runs:

| Control | Sketch API | Hardware it can run on |
|---|---|---|
| `dial({ min, max, step, start, wrap })` | `value`, `delta()` (steps since last read), `fraction` | rotary encoder · slide pot · IMU tilt ←→ or ↑↓ · two buttons − / + · LD2410 distance |
| `trigger({ key })` | `isPressed() wasPressed() wasReleased() pressedFor(ms)` | push button · encoder push · IMU shake · LD2410 presence |

Relative hardware (encoder, buttons) steps a dial; absolute hardware (pot, tilt, distance) sets it,
and on a swap the new hardware takes over at the current value, so nothing jumps. `delta()` works
the same either way, so menu code doesn't care what's turning it. Parts are shared the way a real
bench would: one IMU and one radar per board, and one encoder can turn one control while its push
fires another. The choice is remembered per sketch, and the keyboard keys work whatever the
hardware. Concrete parts (`button()`, `knob()`, `pot()`, `ld2410()`, `imu()`, `buzzer()`) are still
there for sketches that need a specific device, like the radar dashboard parsing UART frames.

Included: **Hello display** (adapts to every display type), **Patterns** (plasma, starfield, Game
of Life, test card …), **Characters** (fonts and a walking sprite), **LD2410 radar** (presence
dashboard) and **Knob menu** (an encoder-driven settings UI).

<details>
<summary>Drawing API</summary>

`width() height() setRotation(0–3) fillScreen drawPixel getPixel drawLine drawFastHLine
drawFastVLine drawRect fillRect drawRoundRect fillRoundRect drawCircle fillCircle drawTriangle
fillTriangle drawBitmap drawRGBBitmap drawSprite setCursor setTextColor(fg, bg?) setTextSize
setTextWrap setFont(null | 'bold 16px monospace') print println drawString(text, x, y, align)
textWidth fontHeight setDither show('auto' | 'full' | 'partial') setBrightness(0–100) isColor() tech`

- **Colours**: `colors.*` (TFT_eSPI names), `color565(r, g, b)`, `hsv565(h, s, v)`, `hex565('#ff8800')`.
  On 1-bit panels a colour lights a pixel at ≥ 50% brightness; `setDither(true)` dithers instead.
- **Fonts**: the classic 5×7 font at any integer size, or any browser font rasterised to 1 bit.
- **Sprites**: `sprite({ palette: { '#': colors.WHITE }, frames: [['.##.', '####']] })`, then
  `display.drawSprite(s, x, y, { frame, scale, flipX })`.

</details>

<details>
<summary>Inputs API</summary>

| Input | Sketch API |
|---|---|
| `button()` | `isPressed() wasPressed() wasReleased() pressedFor(ms) digitalRead()` |
| `knob()`: EC11 encoder with push | `getPosition() setPosition() delta() isPressed() wasPressed()` |
| `pot()` | `read()`: 0–4095 like ESP32 `analogRead`, with ADC noise · `readFloat() readMilliVolts()` |
| `ld2410()` | `read() isConnected() presenceDetected() movingTargetDetected() stationaryTargetDetected() movingTargetDistance() movingTargetEnergy() stationaryTargetDistance() stationaryTargetEnergy() detectionDistance() outPin()`, raw `available() readByte()` |
| `imu()` | `accel() gyro()` |
| `buzzer()` | `beep(hz, ms) tone(hz) stop()` |

The LD2410 is simulated at the UART level: the virtual sensor sends real 23-byte report frames at
10 Hz into a serial buffer and your code parses them, with method names from the Arduino `ld2410`
library. Drag the person around the radar panel (speed decides "moving" vs "stationary"), or let
them wander or approach. Presence is held for the module's 5 s "no-one duration".

</details>

## Resident apps

[Resident](https://github.com/inanimate-tech/resident) is a sandboxed Lua runtime for ESP32 devices
with hot-reloadable apps. screenSim runs those apps unmodified in a real Lua 5.4 VM
([wasmoon](https://github.com/ceifa/wasmoon)), on whichever display is selected.

Pick an app under **Resident apps (Lua)** in the Sketch menu, **drop a `.lua` file on the device**,
or edit the source in the Resident panel and press Run (⌘↵). Included are Resident's own examples
(Swiss railway clock, water-sim, daisy, accelerometer, …) and two that adapt to any screen.

What matches the firmware:

- **Lifecycle**: `init`, `on_tick` every 100 ms with real `dt_ms`, `on_event` from an 8-slot ring,
  `ctx.time_ms`. Apps that define no callback are rejected.
- **Sandbox**: no `os`, `io`, `load`, `require` or `debug`. A 2,000,000-instruction budget per callback
  aborts a runaway loop without killing the app; `on_tick` errors are rate-limited like the device.
- **Modules**: `lgfx` (LovyanGFX bindings; nothing shows until `flip()`), the M5StickC Plus2 board
  surface (`screen`, `imu`, `buzzer`, `button`), `screens`, `log`, `events`, `store` (2048-byte budget,
  kept across reloads), `time` and `datetime` (Resident's own Lua source over a ported strftime).
- **Argument checks** behave like `luaL_checkinteger`: `g:fillRect(1.5, …)` raises the same error here
  as on the device.
- **Buttons** produce `tap`, `hold` (500 ms) and `button` events (keys **A** and **B**). They're
  triggers, so you can swap a button for an encoder push, an IMU shake or the radar.

Not supported yet: LVGL, 32-bit integer wrap-around (the VM is 64-bit), the boot countdown.

### Push apps from your terminal or Claude Code

Press **Connect to relay** in the Resident panel. screenSim connects to
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
The last app that boots is restored on reload. To have agents write apps for screenSim's full surface
(any display, plus `lgfx` and `screens`), pass `--device-skill docs/resident/DEVICE-SKILL.md`.

The device ID is a random secret: anyone who knows it can push apps to your browser while you're
connected. Use **new** in the Resident panel to rotate it.

## Keyboard

| Key | Does |
|---|---|
| Space | the sketch's main button (e.g. BOOT) |
| A / B | Resident buttons 0 and 1 |
| ← / → / Enter | turn / push the rotary encoder |
| Esc | "back" button in the knob menu |

In the 3D view: drag to orbit, double-click to reset, click buttons on the device or the desk to
press them, and shift-drag the device to tilt it when the sketch has an IMU.

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

Enclosure `parts` can be buttons (`input: n` makes one clickable as the sketch's n-th button),
ports, pin headers, mounting holes and LEDs, placed on any face of the body.

To add an input type, subclass `SimInput` in `src/sim/inputs/`, export a factory like `button()`, and
add a widget in `src/ui/widgets/` with a case in `InputPanel.tsx`.

## Project layout

```
src/sim/            simulator core, framework-free
  clock.ts            simulated time: pause, step, speed
  gfx.ts              drawing API          framebuffer.ts   MCU-side buffer + dirty rect
  display.ts          show(): bus timing   panels/          LCD, OLED, e-paper physics
  devices/            one file per display inputs/          button, knob, pot, LD2410, IMU, buzzer
  runner.ts           runs setup()/loop()  renderer.ts      flat canvas view
src/resident/       Resident runtime: wasmoon host, Lua sandbox prelude, relay client, datetime
src/resident-apps/  bundled Lua apps
src/sketches/       bundled TypeScript sketches
src/ui/             React UI; ui/three/ builds the wireframe models from each enclosure
tests/              Vitest: graphics, bus timing, panel physics, LD2410 protocol, Resident sandbox
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
