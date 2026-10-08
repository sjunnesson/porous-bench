# Waveshare 2.13" e-Paper on an ESP32-S3 (epd213, S3 build)

An ESP32-S3 with 8 MB of PSRAM driving a Waveshare 2.13" black-and-white e-paper module (V4), with
two keys. The screen holds its image with no power and changes slowly: each update is a visible
refresh. It suits
glanceable apps that change every few seconds or on a press (status boards, counters, clocks by the
minute, QR codes, menus), not animation. Device type `epd213`.

When porous.systems Bench mirrors an app onto this board, Bench's sensors and controls (dials,
triggers, light, PIR, climate, touch, radar, IMU) reach the app as Bench defines them; the firmware
itself has only the modules below.

## Hardware

- **Screen** `"main"`: 122×250 pixels, portrait, origin top-left, x to the right, y down. 1-bit
  (every pixel is black or white), light scheme: blank is white paper, marks are black. About 130 dpi
  (23.7 × 48.6 mm of glass).
- **Refresh**: partial ≈ 0.3-0.5 s (only changed pixels move), full ≈ 2-3 s (the whole panel
  flashes black/white). Every 10th refresh is full, to clear ghosting. Refreshes run in the background: a
  `flip()` returns at once, and only the newest frame is shown.
- **Keys**: index 0 (key A, the board's BOOT button) and index 1 (key B, an extra button; it may
  not be fitted, so don't make it the only way to do something).
- No backlight, no buzzer, no IMU, no LEDs.

## Lua Modules

### lgfx (preferred for drawing)
**Hardware:** the screen, LovyanGFX-style. Draws into the same frame as `screen`.

```lua
local g = lgfx.bind("main")      -- the handle; bind once at the top of the app
g:fillScreen(0xFFFFFF)           -- colours are 0xRRGGBB; each becomes black or white (see Constraints)
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
g:width()  g:height()            -- 122, 250
g:flip()                         -- nothing changes on the glass until flip
```

Integer arguments are checked: `g:fillRect(1.5, …)` raises, so `math.floor` computed coordinates
(or use `//`).

### screen
**Hardware:** the screen, with the M5Stick drawing verbs (0–255 channels). Same frame as `lgfx`.

```lua
screen.clear([r, g, b])                         -- default black (!): clear(255, 255, 255) for paper
screen.text(x, y, str[, size = 2[, r, g, b]])   -- default white (!): pass 0, 0, 0 on this screen
screen.fill_rect(x, y, w, h, r, g, b)    screen.rect(x, y, w, h, r, g, b)
screen.line(x0, y0, x1, y1, r, g, b)     screen.pixel(x, y, r, g, b)
screen.triangle(x0, y0, x1, y1, x2, y2, r, g, b)
screen.fill_triangle(x0, y0, x1, y1, x2, y2, r, g, b)
screen.qr(x, y, text[, scale = 4[, r, g, b]])   -- QR v3..v10, ECC low, black modules by default;
                                                -- v3 is 29 modules: scale 2 = 58 px, scale 4 = 116 px
screen.flip()
screen.set_brightness(0..255)                   -- accepted, no effect (no backlight)
screen.width()   screen.height()                -- 122, 250
```

### lvgl (widgets)
**Hardware:** the screen, through LVGL 9 (luavgl). LVGL renders in colour and each pixel becomes
black or white by the same luminance rule, so use pure black and white.

```lua
local h = lvgl.bind("main")      -- claims the screen: lgfx/screen flips are dropped while LVGL owns it
h:set_theme {
  screen = { bg_color = 0xFFFFFF, bg_opa = 255 },
  label = { text_color = 0x000000, text_font = lvgl.Font("montserrat", 14) },
}
local title = h.Label { text = "hello", align = lvgl.ALIGN.CENTER }
title:set { text = "changed" }   -- LVGL redraws what changed; each redraw is a panel refresh
h.HOR_RES()  h.VER_RES()         -- 122, 250
```

Fonts: `montserrat` at 8, 14, 16, 20, 24, 28, 32, 36, 40 and 48 px (other sizes snap to the
nearest). Prefer `Object`, `Label`, `Button`, `Arc`, `Line`, `Led` and `Checkbox`: they look the
same on Bench and on the device. No widget receives touch input (there's none). Don't use `lvgl.Anim` or
change widgets every tick: every frame LVGL renders is a panel refresh. Set the end state instead,
and change things every few seconds at most.

### button
**Hardware:** keys A and B (index 0 and 1).

```lua
button.press_count()   -- taps since the app loaded
-- Gestures arrive in on_event(ctx, e):
--   e.name == "tap"    e.data.index (0 = A, 1 = B), e.data.count (taps so far): released before 500 ms
--   e.name == "hold"   e.data.index, e.data.held == true at 500 ms, false on release
--   e.name == "button" the legacy name, sent alongside every tap
```

### screens
**Hardware:** the screen's facts and its one e-paper action.

```lua
local s = screens.get("main")
-- { name = "main", w = 122, h = 250, shape = "rect", depth = 1, scheme = "light", dpi = 130,
--   model = "Waveshare 2.13\" e-Paper (V4)", controller = "SSD1680", tech = "epaper",
--   busy = <a refresh is running>, pending = <a flipped frame is waiting to be shown> }
screens.refresh("main")   -- a full refresh of the current frame (clears ghosting)
```

`screens.set` has no settings on this screen.

## Examples

### Hello, centred

```lua
local g = lgfx.bind("main")

function init(ctx)
  g:fillScreen(0xFFFFFF)
  g:setTextColor(0x000000)
  g:setTextSize(2)
  g:setTextDatum(lgfx.MC_DATUM)
  g:drawString("hello", g:width() // 2, g:height() // 2)
  g:flip()
end
```

### Tap counter (key A), hold to reset

```lua
local g = lgfx.bind("main")
local n = 0

local function draw()
  g:fillScreen(0xFFFFFF)
  g:setTextColor(0x000000)
  g:setTextDatum(lgfx.TC_DATUM); g:setTextSize(2)
  g:drawString("taps", g:width() // 2, 20)
  g:setTextDatum(lgfx.MC_DATUM); g:setTextSize(5)
  g:drawString(tostring(n), g:width() // 2, 125)
  g:flip()
end

function init(ctx) draw() end

function on_event(ctx, e)
  if e.name == "tap" then n = n + 1; draw()
  elseif e.name == "hold" and e.data.held then n = 0; draw() end
end
```

### Clock that changes once a minute

```lua
local g = lgfx.bind("main")
local shown = nil

local function draw(hhmm, date)
  g:fillScreen(0xFFFFFF)
  g:setTextColor(0x000000)
  g:setTextDatum(lgfx.MC_DATUM)
  g:setTextSize(3); g:drawString(hhmm, g:width() // 2, 110)
  g:setTextSize(1); g:drawString(date, g:width() // 2, 140)
  g:flip()
end

function on_tick(ctx)
  if not datetime.synced() then return end   -- 1970 until Wi-Fi sets the clock
  local now = datetime.now()                 -- local: UTC, or Bench's zone once it has mirrored here
  local hhmm = now:strftime("%H:%M")
  if hhmm ~= shown then               -- only flip when the minute changes
    shown = hhmm
    draw(hhmm, now:strftime("%a %d %b"))
  end
end
```

### LVGL: a gauge that follows key presses

```lua
local h = lvgl.bind("main")
h:set_theme {
  screen = { bg_color = 0xFFFFFF, bg_opa = 255 },
  label = { text_color = 0x000000, text_font = lvgl.Font("montserrat", 20) },
}
local level = 5
local arc = h.Arc { x = 11, y = 40, w = 100, h = 100, value = level * 10, arc_color = 0x000000 }  -- 0..100
local label = h.Label { text = "5 / 10", align = lvgl.ALIGN.BOTTOM_MID, y = -40 }

local function show()
  arc:set { value = level * 10 }
  label:set { text = level .. " / 10" }
end

function on_event(ctx, e)
  if e.name == "tap" then
    level = e.data.index == 0 and math.min(10, level + 1) or math.max(0, level - 1)
    show()
  end
end
```

### A QR code with a caption

```lua
function init(ctx)
  screen.clear(255, 255, 255)
  screen.qr(3, 40, "https://porous.systems", 4)   -- v3: 29 x 4 = 116 px
  screen.text(10, 170, "scan me", 2, 0, 0, 0)
  screen.flip()
end
```

### Status board fed by events

```lua
local g = lgfx.bind("main")
local lines = { "waiting..." }

local function draw()
  g:fillScreen(0xFFFFFF)
  g:setTextColor(0x000000); g:setTextSize(1); g:setTextDatum(lgfx.TL_DATUM)
  g:fillRect(0, 0, g:width(), 18, 0x000000)
  g:setTextColor(0xFFFFFF); g:drawString("STATUS", 4, 5)
  g:setTextColor(0x000000)
  for i, l in ipairs(lines) do g:drawString(l, 4, 16 + i * 14) end
  g:flip()
end

function init(ctx) draw() end

function on_event(ctx, e)
  if e.name == "status" and e.data and e.data.text then
    table.insert(lines, 1, tostring(e.data.text):sub(1, 20))
    while #lines > 15 do table.remove(lines) end
    draw()
  end
end
```

## Constraints

- **122×250, 1-bit.** A colour becomes white when its luminance (0.299 R + 0.587 G + 0.114 B) is at
  least 128 of 255, black otherwise. No greys, no dithering: use pure black on pure white.
- **Light scheme.** Blank is white. `screen.clear()` with no arguments and `screen.text` with no
  colour default to black and white respectively (the M5Stick defaults), so pass colours explicitly.
- **Text**: the built-in 6x8 font in whole multiples. Size 1 fits 20 characters across, size 2 fits
  10, size 3 fits 6.
- **Refresh budget**: a partial refresh takes ~0.3-0.5 s and every 10th is a 2-3 s full one. Flipping
  faster than the panel can refresh just drops the in-between frames. `on_tick` runs every 100 ms:
  never flip from it unconditionally.
- **Memory**: Lua and LVGL live in 8 MB of PSRAM: apps of tens of KB are fine.
- Two keys (index 0 and 1); key B may be missing on a given unit.

## Practical Tips

- Draw a whole screen, then `flip()` once. Flip only when something visible changed: the firmware
  also skips a flip whose frame is identical to what's on the glass.
- For text on a black bar, fill the bar and draw white text (`0xFFFFFF`), as in the status example.
- Ghosting builds up over partial refreshes; the periodic full refresh clears it. Call
  `screens.refresh("main")` after a big layout change if you want it crisp right away (it flashes).
- `screen` and `lgfx` share one frame, so they can be mixed; `lgfx` is preferred.
- The clock syncs over Wi-Fi at boot (`datetime.synced()`). Local time (`datetime.now()`) is UTC,
  or the zone Bench runs in once Bench has mirrored an app here; `datetime.now(datetime.UTC)` is
  always UTC.

## Validation stubs

```lua
screen = setmetatable({
  width = function() return 122 end,
  height = function() return 250 end,
}, { __index = function() return function() end end })
button = setmetatable({ press_count = function() return 0 end },
  { __index = function() return function() end end })
screens = {
  get = function() return { name = "main", w = 122, h = 250, shape = "rect", depth = 1,
    scheme = "light", dpi = 130, model = "Waveshare 2.13\" e-Paper (V4)",
    controller = "SSD1680", tech = "epaper", busy = false, pending = false } end,
  list = function() return {} end,
  set = function() end,
  refresh = function() return true end,
}
```
