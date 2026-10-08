# Waveshare ESP32-C6-LCD-1.47 (c6-lcd147)

A thumb-sized ESP32-C6 board with a 1.47" colour IPS LCD (172×320, portrait) and one key. Bright,
sharp and fast enough for small animations, status displays, clocks, counters and little games, as
long as the app is small: there is no PSRAM, so apps get ~84 KB. Device type `c6-lcd147`.

When porous.systems Bench mirrors an app onto this board, Bench's sensors and controls (dials,
triggers, light, PIR, climate, touch, radar, IMU, a silent buzzer) reach the app as Bench defines
them; the firmware itself has only the modules below.

## Hardware

- **Screen** `"main"`: 172×320 pixels, portrait with the USB-C port at the bottom, origin top-left,
  x to the right, y down. 16-bit colour (RGB565), dark scheme: blank is black, the backlight shines
  through. About 251 dpi (17.4 × 32.4 mm of glass). **The corners are rounded** (radius ~20 px):
  anything within ~20 px of a corner is clipped, while the straight edges show to the last pixel.
- **Backlight**: dimmable, 0..255 (`screen.set_brightness`) or 0..1 (`screens.set`). Every app
  starts at full brightness.
- **Key**: one, BOOT, index 0 (key A). There is no key B.
- No IMU, no buzzer, no touch panel. An RGB LED on the back isn't available to apps.

## Lua Modules

### lgfx (preferred for drawing)
**Hardware:** the screen, LovyanGFX-style. Draws into the same frame as `screen`.

```lua
local g = lgfx.bind("main")      -- the handle; bind once at the top of the app
g:fillScreen(0x000000)           -- colours are 0xRRGGBB (shown as RGB565)
g:drawPixel(x, y, c)   g:drawLine(x0, y0, x1, y1, c)
g:drawRect(x, y, w, h, c)        g:fillRect(x, y, w, h, c)
g:drawRoundRect(x, y, w, h, r, c)  g:fillRoundRect(x, y, w, h, r, c)
g:drawCircle(x, y, r, c)         g:fillCircle(x, y, r, c)
g:drawTriangle(x0, y0, x1, y1, x2, y2, c)  g:fillTriangle(x0, y0, x1, y1, x2, y2, c)
g:setTextColor(fg[, bg])         -- with bg, glyph cells are filled
g:setTextSize(n)                 -- whole multiples of the 6x8 font: 1 = 6x8 px, 2 = 12x16 px, ...
g:setTextDatum(lgfx.MC_DATUM)    -- TL TC TR ML MC MR BL BC BR _DATUM, L/C/R_BASELINE (for drawString)
g:setCursor(x, y)  g:print("text")   -- print wraps at the right edge
g:drawString("text", x, y)       -- anchored by the datum, never wraps
g:width()  g:height()            -- 172, 320
g:flip()                         -- nothing changes on the glass until flip
```

Integer arguments are checked: `g:fillRect(1.5, …)` raises, so `math.floor` computed coordinates
(or use `//`).

### screen
**Hardware:** the screen, with the M5Stick drawing verbs (0–255 channels). Same frame as `lgfx`.

```lua
screen.clear([r, g, b])                         -- default black
screen.text(x, y, str[, size = 2[, r, g, b]])   -- default white
screen.fill_rect(x, y, w, h, r, g, b)    screen.rect(x, y, w, h, r, g, b)
screen.line(x0, y0, x1, y1, r, g, b)     screen.pixel(x, y, r, g, b)
screen.triangle(x0, y0, x1, y1, x2, y2, r, g, b)
screen.fill_triangle(x0, y0, x1, y1, x2, y2, r, g, b)
screen.qr(x, y, text[, scale = 4[, r, g, b]])   -- QR v3..v10, ECC low, black modules by default:
                                                -- clear a white square behind it; v3 is 29 modules
screen.flip()                                   -- pushes the whole frame (~32 ms)
screen.set_brightness(0..255)                   -- the backlight
screen.width()   screen.height()                -- 172, 320
```

### button
**Hardware:** the BOOT key (index 0).

```lua
button.press_count()   -- taps since the app loaded
-- Gestures arrive in on_event(ctx, e):
--   e.name == "tap"    e.data.index (0), e.data.count (taps so far): released before 500 ms
--   e.name == "hold"   e.data.index, e.data.held == true at 500 ms, false on release
--   e.name == "button" the legacy name, sent alongside every tap
```

### screens
**Hardware:** the screen's facts and its one setting.

```lua
local s = screens.get("main")
-- { name = "main", w = 172, h = 320, shape = "rect", depth = 16, scheme = "dark", dpi = 251,
--   brightness = 0..1, model = "Waveshare ESP32-C6-LCD-1.47", controller = "ST7789V3", tech = "lcd" }
screens.set("main", { brightness = 0.3 })   -- 0..1, the backlight
```

## Examples

### Hello, centred

```lua
local g = lgfx.bind("main")

function init(ctx)
  g:fillScreen(0x000000)
  g:setTextColor(0xFFFFFF)
  g:setTextSize(2)
  g:setTextDatum(lgfx.MC_DATUM)
  g:drawString("hello", g:width() // 2, g:height() // 2)
  g:flip()
end
```

### Tap counter, hold to reset

```lua
local g = lgfx.bind("main")
local n = 0

local function draw()
  g:fillScreen(0x000000)
  g:setTextColor(0x00C0FF)
  g:setTextDatum(lgfx.TC_DATUM); g:setTextSize(2)
  g:drawString("taps", g:width() // 2, 40)
  g:setTextColor(0xFFFFFF)
  g:setTextDatum(lgfx.MC_DATUM); g:setTextSize(6)
  g:drawString(tostring(n), g:width() // 2, 160)
  g:flip()
end

function init(ctx) draw() end

function on_event(ctx, e)
  if e.name == "tap" then n = n + 1; draw()
  elseif e.name == "hold" and e.data.held then n = 0; draw() end
end
```

### Bouncing ball

```lua
local g = lgfx.bind("main")
local W, H, R = g:width(), g:height(), 10
local x, y, vx, vy = 60, 80, 3, 4

function on_tick(ctx)
  x, y = x + vx, y + vy
  if x < R or x > W - R then vx = -vx end
  if y < R or y > H - R then vy = -vy end
  g:fillScreen(0x101018)
  g:fillCircle(x // 1, y // 1, R, 0xFF8800)
  g:flip()
end
```

### Dim on hold

```lua
local g = lgfx.bind("main")
local dim = false

local function draw()
  g:fillScreen(0x000000)
  g:setTextColor(0xFFFFFF); g:setTextSize(2); g:setTextDatum(lgfx.MC_DATUM)
  g:drawString(dim and "dim" or "bright", g:width() // 2, g:height() // 2)
  g:flip()
end

function init(ctx) draw() end

function on_event(ctx, e)
  if e.name == "hold" and e.data.held then
    dim = not dim
    screen.set_brightness(dim and 40 or 255)
    draw()
  end
end
```

### A QR code with a caption

```lua
function init(ctx)
  screen.clear(0, 0, 0)
  screen.fill_rect(20, 60, 132, 132, 255, 255, 255)   -- white quiet zone
  screen.qr(28, 68, "https://porous.systems", 4)      -- v3: 29 x 4 = 116 px
  screen.text(26, 220, "scan me", 2)
  screen.flip()
end
```

## Constraints

- **172×320, 16-bit colour, dark scheme.** Keep content ~20 px from the corners (rounded glass).
- **Text**: the built-in 6x8 font in whole multiples. Size 1 fits 28 characters across, size 2
  fits 14, size 3 fits 9.
- **Frame rate**: `flip()` pushes the whole frame in ~32 ms. `on_tick` runs every 100 ms, so a
  flip per tick is easy; there's no faster timer.
- **Memory: small apps only.** Apps run in a Lua heap of their own, ~84 KB of it free when an app
  arrives. Loading takes ~6x the app's size (the message, then compiling), so keep an app under
  ~8 KB of Lua. An app that doesn't fit stops with "not enough memory"; the board stays online and
  takes the next app. Don't build big tables of precomputed data; `datetime` costs ~35 KB once
  touched, so use it only when it matters.
- **No `lvgl`** on this board.
- One key (index 0).

## Practical Tips

- Draw a whole frame, then `flip()` once; the screen shows nothing in between.
- For animation, redraw in `on_tick` and flip once per tick.
- `screen` and `lgfx` share one frame, so they can be mixed; `lgfx` is preferred.
- Centre important things: the rounded corners eat ~20 px diagonally, the top and bottom edges
  less so.
- The clock syncs over Wi-Fi at boot; the board's zone is UTC.

## Validation stubs

```lua
screen = setmetatable({
  width = function() return 172 end,
  height = function() return 320 end,
}, { __index = function() return function() end end })
button = setmetatable({ press_count = function() return 0 end },
  { __index = function() return function() end end })
screens = {
  get = function() return { name = "main", w = 172, h = 320, shape = "rect", depth = 16,
    scheme = "dark", dpi = 251, brightness = 1, model = "Waveshare ESP32-C6-LCD-1.47",
    controller = "ST7789V3", tech = "lcd" } end,
  list = function() return {} end,
  set = function() end,
  refresh = function() return false end,
}
```

## App mode / Shader mode

Shader mode is not available on this device — only app mode is supported.
