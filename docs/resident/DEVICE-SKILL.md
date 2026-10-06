# porous.systems Bench (Resident simulator board)

Bench is a browser simulator that runs Resident apps on a choice of virtual displays. Its board
surface is the M5StickC Plus2's (`screen`, `imu`, `buzzer`, `button`, two buttons) plus `lgfx`, on
whichever display the user has selected, plus three Bench drivers for hardware on its desk (`dial`,
`trigger`, `ld2410`). Apps written for the M5Stick run unchanged; apps that read
`screens.get("main")` adapt to every display.

Pass this file to the Resident plugin: `/resident:create-app --device-skill docs/resident/DEVICE-SKILL.md …`

## Hardware

**Screen** `"main"`: the selected display. Ask for its facts, never assume them:

```lua
local s = screens.get("main")   -- { name, w, h, shape, depth = 16 | 1, scheme = "dark" | "light", dpi?, brightness,
                                --   model, controller, tech = "lcd" | "oled" | "epaper" }  (the last three are Bench extras)
```

| Display | Size seen by apps | depth | scheme | Notes |
|---|---|---|---|---|
| M5StickC Plus2 / M5StickS3 | 240×135 (landscape) | 16 | dark | the default Resident board |
| Waveshare ESP32-C6-LCD-1.47 | 172×320 | 16 | dark | rounded corners: keep ~20 px clear |
| 1.3" ST7789 | 240×240 | 16 | dark | |
| SSD1306 OLED | 128×64 or 128×32 | 1 | dark | colours threshold to lit/unlit at 50% brightness |
| 2.13" e-paper | 122×250 | 1 | light | every `flip()` is a refresh: 2 s full, 0.3 s partial; flip rarely |

On 1-bit screens use pure white for marks on a dark scheme, pure black on a light one.

**Buttons**: two, indices 0 (key A) and 1 (key B). Gestures arrive in `on_event`: `tap`
(`e.data.index`, `e.data.count`) on a release before 500 ms, `hold` (`e.data.held = true` at 500 ms,
`false` on release). A legacy `button` event fires alongside `tap`.

**IMU**: 6-axis, body frame. At rest face-up `imu.accel()` ≈ `(0, 0, 1)` g; the user tilts it with a
pad and can shake it. `imu.gyro()` in °/s. `imu.temp()` returns 0.

**Buzzer**: square-wave piezo, 20–20000 Hz (clamped), durations up to 5000 ms.

## Lua modules

### lgfx (preferred)

```lua
local g = lgfx.bind("main")
g:fillScreen(0x000000)
g:setTextColor(0xFFFFFF); g:setTextSize(2); g:setTextDatum(lgfx.MC_DATUM)
g:drawString("hi", g:width() // 2, g:height() // 2)
g:flip()                          -- nothing is visible until flip
```

Full sheet: Resident's `prompts/lgfx.md`. Integer arguments are checked like `luaL_checkinteger`:
`g:fillRect(1.5, …)` raises, so `math.floor` computed coordinates.

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
Which hardware drives a dial or trigger is the user's choice in Bench's Controls panel, so write
against the API, not a specific part.

```lua
local speed = dial.new("speed", { min = 1, max = 10, step = 1, start = 3 })
--   options: label, min, max, step, start, wrap, via = "encoder" | "pot" | "imu-x" | "imu-y" | "buttons" | "radar",
--            keys = { down = "ArrowLeft", up = "ArrowRight" }
speed:value()   speed:delta()   -- steps since the last call   speed:fraction()   -- 0..1 in the range

local fire = trigger.new("fire", { key = "Space" })
--   options: label, key (a KeyboardEvent.code), via = "button" | "external-button" | "encoder-push" | "shake" | "presence"
fire:is_pressed()   fire:was_pressed()   fire:was_released()   fire:pressed_for(ms)

ld2410.begin({ mode = "wander" })   -- "wander" | "approach" | "empty" | "manual"
local r = ld2410.read()  -- { connected, moving, still, distance_cm, moving_cm, moving_energy, still_cm, still_energy, out }
```

Driver events arrive in `on_event` with `e.channel == "driver"`: `dial` `{ name, value, delta }` when a
dial moves, `trigger` `{ name, pressed }` on each edge, `presence` `{ moving, still, distance_cm }` when
the radar's state changes. Poll in `on_tick` or react to events, whichever reads better. These
modules exist only on Bench (or a board whose firmware provides them); guard with `if dial then`
for apps that should also run on a plain M5Stick.

Plus every universal module from Resident's `prompts/sandbox.md`: `log`, `events`, `store`,
`time`, `datetime` (local zone = the browser's), `screens`.

### lvgl (optional)

LVGL 9 through luavgl, per Resident's `prompts/lvgl.md`. `lvgl.bind("main")` returns the display
handle and claims the panel (`lgfx` flips are then dropped: one library per panel). Fonts: the
`montserrat` family at 8, 14, 16, 20, 24, 28, 32, 36, 40 and 48 px (`lvgl.Font("montserrat", 20)`;
other sizes snap to the nearest). Put continuous motion in `lvgl.Anim`: LVGL's timer pump runs every
33 ms, `on_tick` only every 100. Bench draws `Object`, `Label`, `Button`, `Arc`, `Line`, `Led` and
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
```
