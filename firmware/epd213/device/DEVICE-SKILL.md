# Waveshare 2.13" e-Paper board (epd213)

A Waveshare ESP32 e-Paper Driver Board with a 2.13" black-and-white e-paper panel and one key. The
screen holds its image with no power and changes slowly: each update is a visible refresh. It suits
glanceable apps that change every few seconds or on a press (status boards, counters, clocks by the
minute, QR codes, menus), not animation. Device type `epd213`.

When porous.systems Bench mirrors an app onto this board, Bench's sensors and controls (dials,
triggers, light, PIR, climate, touch, radar, IMU) reach the app as Bench defines them; the firmware
itself has only the modules below.

## Hardware

- **Screen** `"main"`: 122×250 pixels, portrait, origin top-left, x to the right, y down. 1-bit
  (every pixel is black or white), light scheme: blank is white paper, marks are black. About 130 dpi
  (23.7 × 48.6 mm of glass).
- **Refresh**: partial ≈ 0.2 s (only changed pixels move), full ≈ 1.9 s (the whole panel flashes
  black/white). Every 10th refresh is full, to clear ghosting. Refreshes run in the background: a
  `flip()` returns at once, and only the newest frame is shown.
- **Key**: one button, index 0 (key A, the board's IO12 key). There is no key B on the hardware.
- No backlight, no buzzer, no IMU, no LEDs.

## Lua Modules

### lgfx (preferred)
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

### button
**Hardware:** the one key (index 0).

```lua
button.press_count()   -- taps since the app loaded
-- Gestures arrive in on_event(ctx, e):
--   e.name == "tap"    e.data.index == 0, e.data.count (taps so far): released before 500 ms
--   e.name == "hold"   e.data.index == 0, e.data.held == true at 500 ms, false on release
--   e.name == "button" the legacy name, sent alongside every tap
```

### screens
**Hardware:** the screen's facts and its one e-paper action.

```lua
local s = screens.get("main")
-- { name = "main", w = 122, h = 250, shape = "rect", depth = 1, scheme = "light", dpi = 130,
--   model = "Waveshare 2.13\" e-Paper (V2, HINK-E0213A22)", controller = "IL3897", tech = "epaper",
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
  local now = datetime.now()                 -- UTC on this board
  local hhmm = now:strftime("%H:%M")
  if hhmm ~= shown then               -- only flip when the minute changes
    shown = hhmm
    draw(hhmm, now:strftime("%a %d %b"))
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
- **Refresh budget**: a partial refresh takes ~0.2 s and every 10th is a 1.9 s full one. Flipping
  faster than the panel can refresh just drops the in-between frames. `on_tick` runs every 100 ms:
  never flip from it unconditionally.
- **Memory is tight**: no PSRAM, and about 70 KB of heap is shared by the incoming app, the Lua
  compiler (~4x the source size) and the running app. Keep apps to a few KB of source: Bench's
  tilt-ball and lgfx-hello (~1.5 KB, ~13-16 KB to compile when mirrored) run, its 11 KB water-sim
  doesn't. `datetime` takes ~35 KB once touched.
  Apps that fail to compile just leave the previous screen up.
- **No `lvgl`**: LVGL apps don't run on this board.
- One key (index 0). Code for key B (`e.data.index == 1`) only fires when Bench mirrors the app.

## Practical Tips

- Draw a whole screen, then `flip()` once. Flip only when something visible changed: the firmware
  also skips a flip whose frame is identical to what's on the glass.
- For text on a black bar, fill the bar and draw white text (`0xFFFFFF`), as in the status example.
- Ghosting builds up over partial refreshes; the periodic full refresh clears it. Call
  `screens.refresh("main")` after a big layout change if you want it crisp right away (it flashes).
- `screen` and `lgfx` share one frame, so they can be mixed; `lgfx` is preferred.
- The clock syncs over Wi-Fi at boot (`datetime.synced()`); the board's zone is UTC, so
  `datetime.now()` is UTC unless the app passes a zone.

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
    scheme = "light", dpi = 130, model = "Waveshare 2.13\" e-Paper (V2, HINK-E0213A22)",
    controller = "IL3897", tech = "epaper", busy = false, pending = false } end,
  list = function() return {} end,
  set = function() end,
  refresh = function() return true end,
}
```
