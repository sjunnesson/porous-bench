# screenSim

A browser playground for small displays of the kind you wire to an ESP32 (LCD, OLED, e-paper), plus
the inputs that drive them (buttons, rotary encoders, pots, an LD2410 presence radar).

Two kinds of program run on it:

- **TypeScript sketches** in an Arduino shape (`setup()` / `loop()`), using a drawing API modelled on
  Adafruit_GFX/TFT_eSPI, so porting to C++ is mostly a matter of removing `await`.
- **[Resident](https://github.com/inanimate-tech/resident) Lua apps**, unmodified, in a real Lua 5.4
  VM. screenSim can also join the Resident relay as a device, so apps pushed with `/resident:push-app`
  or `curl` land in the browser.

Devices are drawn as a ghosted 3D wireframe of the real part (drag to orbit, click its buttons), or
flat and pixel-exact with zoom and a pixel grid.

```sh
npm install
npm run dev        # http://localhost:5199
npm test           # unit tests for the simulator core
npm run build      # static site in dist/, hostable anywhere
```

## What gets simulated

| | LCD | OLED | E-paper |
|---|---|---|---|
| Pixel format | RGB565 | 1-bit (lit/unlit) | 1-bit (ink/paper) |
| Look | backlight × IPS black level, rounded glass | glass tint incl. yellow/blue split, pixel gaps | paper/ink colours |
| Timing | `show()` waits for the SPI transfer of the changed rectangle | I2C transfer of whole 8-row pages (≈40 fps ceiling at 400 kHz) | RAM write + 2 s full / 0.3 s partial refresh |
| Quirks | power-on RAM noise until the first frame | brightness = contrast | full refresh flashes; partial refresh leaves ghosting until the next full one |

Everything runs on a simulated clock: **Pause**, **Step** and **0.1×–4× speed** apply to delays, bus
transfers, e-paper refreshes and sensor data alike.

The **LD2410** is simulated at the UART level. The virtual sensor emits real 23-byte report frames
at 10 Hz into a serial buffer, and the sketch parses them. Drag the person around the radar panel
(speed decides "moving" vs "stationary"), or let them wander or approach. Presence is held for the
5 s "no-one duration" like the real module. The panel shows the raw frame bytes.

Not simulated (yet): controller command protocols byte-for-byte, MCU CPU speed, touch, colour e-paper.

## Resident apps

Pick one under **Resident apps (Lua)** in the Sketch menu, drop a `.lua` file on the device, or edit
the source in the Resident panel and press Run (⌘↵). Every display works: the app sees the selected
display as screen `"main"`, M5Stick boards run landscape like the firmware.

What's implemented, matching the firmware (`src/resident/`):

- Lifecycle: `init`, `on_tick` every 100 ms with real `dt_ms`, `on_event` from an 8-slot ring;
  `ctx.time_ms`, `generation_id`. Apps must define one callback or they're rejected.
- Sandbox: no `os`/`io`/`load`/`require`/`debug`; a 2,000,000-instruction budget per callback (a
  runaway loop aborts that dispatch, not the app); errors are contained and `on_tick` errors are
  rate-limited like the device.
- `lgfx` (LovyanGFX bindings, `flip()` presents the whole frame), `screen`/`imu`/`buzzer`/`button`
  (the M5StickC Plus2 board drivers), `screens`, `log`, `events` (Resident's JSON rules, 5/s token
  bucket, 16-deep queue), `store` (2048-byte budget, kept in localStorage), `time` (wrapping ticks
  + the deprecated calendar half), `datetime` (Resident's own Lua source, vendored, over ported
  calendar/strftime primitives).
- Argument checks behave like `luaL_checkinteger`/`luaL_checknumber`, so `g:fillRect(1.5, …)`
  raises the same error it would on the device.
- Buttons produce `tap`/`hold` (500 ms)/`button` events; IMU is a tilt pad with a shake; the buzzer
  plays through Web Audio.

Not there: LVGL (`lvgl.bind` raises), 32-bit numbers (the VM is 64-bit, so integer wrap-around
differs), the boot countdown, Wi-Fi/captive portal.

### Push from a terminal or Claude Code

In the Resident panel press **Connect to relay**. screenSim opens
`wss://resident.inanimate.tech/devices/<sim-xxxxxxxx>` like the firmware does and shows its device
ID. Then:

```sh
# Resident's Claude Code plugin
/plugin marketplace add inanimate-tech/agent-plugins
/plugin install resident@inanimate
RESIDENT_DEVICE_ID=sim-xxxxxxxx  /resident:push-app give me a lil guy

# or plain curl
curl -X POST https://resident.inanimate.tech/devices/sim-xxxxxxxx/send \
  -H 'Content-Type: application/json' -d '{"type":"app","code":"function init(ctx) screen.text(10,10,\"hi\") screen.flip() end"}'
```

Pushed apps, `chunk` patches, `channel:"app"` events, `forget` and the host `hello` time zone are all
handled. The last app that boots is saved and restored on reload. `sim-` IDs make the plugin use its
bundled M5Stick surface; for the full screenSim surface pass
`--device-skill docs/resident/DEVICE-SKILL.md`.

## Writing a sketch

Drop a file in `src/sketches/`; it shows up in the Sketch menu. Saving it hot-restarts it.

```ts
import { button, colors, defineSketch, hsv565, knob, ld2410 } from '../sim';

let x = 0;

export default defineSketch({
  name: 'My sketch',
  inputs: {
    fire: button({ label: 'Fire', key: 'Space', gpio: 9 }),
    speed: knob({ label: 'Speed', min: 1, max: 10, start: 3 }),
    radar: ld2410(),
  },
  setup({ display }) {
    display.fillScreen(colors.BLACK);
    x = 0;
  },
  async loop({ display, inputs, millis, delay, log }) {
    inputs.radar.read();
    if (inputs.fire.wasPressed()) log('fire!');
    display.fillCircle(x, 40, 6, hsv565(millis() / 10, 1, 1));
    x = (x + inputs.speed.getPosition()) % display.width();
    await display.show();   // takes as long as the real bus transfer
    await delay(16);
  },
});
```

**Display**: `width() height() setRotation(0-3) fillScreen drawPixel getPixel drawLine drawFastHLine
drawFastVLine drawRect fillRect drawRoundRect fillRoundRect drawCircle fillCircle drawTriangle
fillTriangle drawBitmap drawRGBBitmap drawSprite setCursor setTextColor(fg, bg?) setTextSize
setTextWrap setFont(null | 'bold 16px monospace') print println drawString(text, x, y, align)
textWidth fontHeight setDither show('auto'|'full'|'partial') setBrightness(0-100) isColor() tech`

**Colours** are RGB565 numbers: `colors.*` (TFT_eSPI names), `color565(r,g,b)`, `hsv565(h,s,v)`,
`hex565('#ff8800')`. On 1-bit panels a colour lights a pixel when its brightness is ≥ 50%; call
`setDither(true)` for ordered dithering.

**Sprites**: `sprite({ palette: { '#': colors.WHITE }, frames: [['.##.', '####']] })`, then
`display.drawSprite(s, x, y, { frame, scale, flipX })`.

**Inputs** (declare them in `inputs`; widgets and keyboard bindings appear automatically):

| Input | Sketch API |
|---|---|
| `button()` | `isPressed() wasPressed() wasReleased() pressedFor(ms) digitalRead()` |
| `knob()` (EC11 encoder + push) | `getPosition() setPosition() delta() isPressed() wasPressed()` |
| `pot()` | `read()` (0–4095, like ESP32 `analogRead`, with ADC noise) `readFloat() readMilliVolts()` |
| `ld2410()` | `read() isConnected() presenceDetected() movingTargetDetected() stationaryTargetDetected() movingTargetDistance() movingTargetEnergy() stationaryTargetDistance() stationaryTargetEnergy() detectionDistance() outPin()`, raw `available() readByte()` |

The LD2410 method names match the Arduino `ld2410` library.

## Adding a display

Drop a file in `src/sim/devices/` exporting a `DeviceProfile` (see `types.ts`); it appears in the
Display menu. Give it an `enclosure` (body size in mm, screen position, buttons/ports/headers per
face) and the 3D view draws it; buttons with an `input` index are clickable. Resolution, technology, bus speed and look are simulated. Controller, RAM offsets,
wiring and porting notes are shown in the Device panel so the facts you need on hardware live with
the profile. Example: `waveshare-esp32-c6-lcd-1.47.ts`.

## Adding an input type

Subclass `SimInput` in `src/sim/inputs/` (sketch-facing methods + UI-facing setters), export a
factory like `button()`, and add a widget in `src/ui/widgets/` plus a case in `InputPanel.tsx`.

## Layout

```
src/sim/            simulator core, no React (unit-tested in tests/)
  clock.ts          simulated time: pause / step / speed
  gfx.ts            drawing API      framebuffer.ts  MCU-side buffer + dirty rect
  display.ts        show(): bus timing → panel        panels/  lcd, oled, epaper physics
  devices/          one file per display              inputs/  button, knob, pot, ld2410
  runner.ts         runs setup()/loop()               renderer.ts  draws the panel on a <canvas>
src/resident/       Resident runtime: wasmoon host, Lua prelude (sandbox + modules), relay, datetime
src/resident-apps/  bundled Lua apps (Resident's examples, MIT, plus a couple of lgfx ones)
src/sketches/       example TypeScript sketches (one file each)
src/ui/three/       ghosted wireframe models built from each profile's enclosure
src/ui/             React UI: device view, input widgets, device info, console
```
