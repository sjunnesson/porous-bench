-- Hello display: device facts, colour bars and a DVD-style bouncing ball, animated with lvgl.Anim. Adapts to LCD, OLED and e-paper. A changes the colour.
local h = lvgl.bind("main")
local s = screens.get("main")
local W, H = h.HOR_RES(), h.VER_RES()
-- Round glass (shape "round"): lay everything out in the square inside the circle.
local ui = h
if s.shape == "round" then
  local side = math.floor(math.min(W, H) * 0.7071)
  local box = h.Object { x = (W - side) // 2, y = (H - side) // 2, w = side, h = side,
    bg_opa = 0, border_width = 0, pad_all = 0, radius = 0 }
  ui = setmetatable({}, { __index = function(_, kind) return function(props) return box[kind](box, props) end end })
  W, H = side, side
end
local color = s.depth == 16
local paper = s.scheme == "light" -- e-paper: every LVGL refresh is a slow panel refresh
local BG = paper and 0xFFFFFF or 0x000000
local FG = paper and 0x000000 or 0xFFFFFF

-- Size classes: a 128x32 strip, a 128x64 OLED, a landscape stick, and roomy screens.
local tiny = H < 48
local small = not tiny and H < 100
local large = H >= 180
local medium = not (tiny or small or large)
local F = (tiny or small) and 8 or 14 -- body font
local pad = large and 10 or (medium and 4 or 2) -- side margin (rounded corners on large panels)

h:set_theme {
  screen = { bg_color = BG, bg_opa = 255 },
  object = { bg_opa = 0, border_width = 0, pad_all = 0, radius = 0 },
  label = { text_color = FG, text_font = lvgl.Font("montserrat", F) },
}

-- 0xRRGGBB from hue (degrees), saturation and value (0..1).
local function hsv(hue, sat, v)
  hue = hue % 360
  local c = v * sat
  local x = c * (1 - math.abs((hue / 60) % 2 - 1))
  local r, gr, b
  if hue < 60 then r, gr, b = c, x, 0
  elseif hue < 120 then r, gr, b = x, c, 0
  elseif hue < 180 then r, gr, b = 0, c, x
  elseif hue < 240 then r, gr, b = 0, x, c
  elseif hue < 300 then r, gr, b = x, 0, c
  else r, gr, b = c, 0, x end
  local m = v - c
  local function byte(u) return math.floor((u + m) * 255 + 0.5) end
  return (byte(r) << 16) | (byte(gr) << 8) | byte(b)
end

-- Put the first text that fits `avail` px into a label; failing that, clip the last one.
-- (Built-in LVGL Montserrat is ASCII plus symbols, so separators are lvgl.SYMBOL.BULLET.)
local function fit(lbl, texts, avail)
  for _, t in ipairs(texts) do
    lbl:set { text = t }
    if lbl:get_width() <= avail then return t end
  end
  local t = texts[#texts]
  while #t > 1 do
    t = t:sub(1, #t - 1)
    lbl:set { text = t .. ".." }
    if lbl:get_width() <= avail then break end
  end
  return t
end

local function anim(obj, para)
  if paper then -- e-paper: jump to the end state instead of animating
    if para.exec_cb then para.exec_cb(obj, para.end_value) end
    return nil
  end
  para.run = para.run ~= false
  return obj:Anim(para)
end

-- ── header and device facts ────────────────────────────────────────────────

local y = 0
if medium or large then
  local hh = large and 26 or 18
  local bar = ui.Object { x = 0, y = 0, w = W, h = hh, bg_opa = 255, bg_color = color and 0x18408C or FG }
  bar:Label { text = "Bench", align = lvgl.ALIGN.CENTER, text_color = color and 0xFFFFFF or BG,
    text_font = lvgl.Font("montserrat", large and 16 or 14) }
  y = hh + (large and 6 or 2)
end

local model = s.model or "display"
local spec = h.HOR_RES() .. "x" .. h.VER_RES() .. ((s.controller and s.controller ~= "") and (" " .. s.controller) or "")
local lineH = math.ceil(F * 1.17)
if small then
  -- One line: as much as fits.
  local l = ui.Label { x = pad, y = 1 }
  fit(l, { model .. "  " .. spec, model, spec }, W - 2 * pad)
  y = lineH + 2
elseif not tiny then
  local l1 = ui.Label { x = pad, y = y }
  fit(l1, { model }, W - 2 * pad)
  local l2 = ui.Label { x = pad, y = y + lineH, text_color = color and 0xC6C3C6 or FG }
  fit(l2, { spec }, W - 2 * pad)
  y = y + 2 * lineH + 2
end

-- ── colour bars along the bottom (1-bit: a ramp of thinning bars) ──────────

local barsH = tiny and 0 or small and 5 or medium and 10 or math.max(10, math.min(24, H // 12))
local barsX, barsW = large and pad or 0, large and W - 2 * pad or W
local barsY = H - barsH - (large and pad or 0)
if barsH > 0 then
  for i = 0, 7 do
    local x0, x1 = barsX + i * barsW // 8, barsX + (i + 1) * barsW // 8
    if color then
      ui.Object { x = x0, y = barsY, w = x1 - x0, h = barsH, bg_opa = 255, bg_color = hsv(i * 45, 1, 1) }
    else
      local w = math.max(1, (x1 - x0) * (8 - i) // 8)
      ui.Object { x = x0, y = barsY, w = w, h = barsH, bg_opa = 255, bg_color = FG }
    end
  end
end

-- ── footer: uptime and the pump rates (text only, set from on_tick) ────────

local footColor = color and 0xB4FF2F or FG
local uptime = ui.Label { x = pad, y = 0, text_color = footColor }
uptime:set { text = paper and "up 0000 s" or "000.0 s" }
local upW = uptime:get_width()
local B = " " .. lvgl.SYMBOL.BULLET .. " "
local notes = paper
  and { "e-paper" .. B .. "every 5 s", "every 5 s", "" }
  or { "anim ~30 fps" .. B .. "tick 10 Hz", "anim 30fps" .. B .. "tick 10Hz", "30fps" .. B .. "10Hz", "" }
local note = ui.Label { text_color = color and 0x8A8AA6 or FG }
local footBottom = barsY - (barsH > 0 and 2 or 0)
local footTop
if large then
  -- Room to stack: uptime above, the note under it.
  fit(note, notes, W - 2 * pad)
  footTop = footBottom - 2 * lineH
  uptime:set { y = footTop }
  note:set { x = pad, y = footTop + lineH }
else
  footTop = footBottom - lineH
  uptime:set { y = footTop }
  fit(note, notes, W - 2 * pad - upW - 6)
  note:set { align = lvgl.ALIGN.TOP_RIGHT, x = -pad, y = footTop }
end
uptime:set { text = paper and "up 0 s" or "0.0 s" }

-- ── the arena and its DVD ball ─────────────────────────────────────────────

local ax, aw = large and pad or 0, large and W - 2 * pad or W
local ay = y
local ah = math.max(4, footTop - 2 - ay)
local r = math.max(3, math.min(16, math.min(aw, ah) // 7))
local D = 2 * r
local arena = ui.Object { x = ax, y = ay, w = aw, h = ah }
local ball = arena:Object { x = 0, y = 0, w = D, h = D, radius = lvgl.RADIUS_CIRCLE, bg_opa = 255, bg_color = FG }
local rangeX, rangeY = math.max(0, aw - D), math.max(0, ah - D)

-- Constant speed per axis, with periods that don't line up, so the path wanders like a DVD logo.
local speed = math.max(40, W * 0.6) -- px/s across
local durX = math.max(300, math.floor(rangeX * 1000 / speed))
local durY = math.max(300, math.floor(rangeY * 1000 / (speed * 0.75)))
if math.abs(durX - durY) < 150 or durX % durY == 0 or durY % durX == 0 then durY = durY + 377 end

local function bounce(range, dur, prop)
  if range <= 0 then return end
  anim(ball, {
    start_value = 0, end_value = range, duration = dur, playback_time = dur,
    path = "linear", repeat_count = lvgl.ANIM_REPEAT_INFINITE,
    exec_cb = function(obj, v) obj:set { [prop] = v } end,
  })
end
bounce(rangeX, durX, "translate_x")
bounce(rangeY, durY, "translate_y")

-- Hue: a full turn every 10 s on colour panels. Button A shifts it by 70 degrees.
local hueShift, hueNow = 200, 0
local function paint() ball:set { bg_color = hsv(hueShift + hueNow, 0.8, 1) } end
if color then
  paint()
  anim(ball, {
    start_value = 0, end_value = 359, duration = 10000, path = "linear",
    repeat_count = lvgl.ANIM_REPEAT_INFINITE,
    exec_cb = function(_, v) hueNow = v paint() end,
  })
end
local ring = false -- 1-bit: A swaps a filled ball for a ring

-- e-paper: where the anims would have the ball at time t (a triangle wave per axis).
local function tri(t, dur, range)
  if range <= 0 then return 0 end
  local ph = t % (2 * dur)
  if ph > dur then ph = 2 * dur - ph end
  return range * ph // dur
end

function init(ctx)
  log.info("Running on " .. model .. ": " .. h.HOR_RES() .. "x" .. h.VER_RES())
end

local wait = 0
function on_tick(ctx, dt_ms)
  local now = ctx.time_ms
  if paper then
    wait = wait + dt_ms
    if wait < 5000 then return end
    wait = 0
    -- One refresh every 5 s: jump the ball and the uptime together.
    ball:set { translate_x = tri(now, durX, rangeX), translate_y = tri(now, durY, rangeY) }
    uptime:set { text = "up " .. now // 1000 .. " s" }
    return
  end
  uptime:set { text = string.format("%.1f s", now / 1000) }
end

function on_event(ctx, e)
  if e.name == "tap" and e.data.index == 0 then
    if color then
      hueShift = (hueShift + 70) % 360
      paint()
    else
      ring = not ring
      ball:set(ring and { bg_opa = 0, border_width = math.max(1, r // 3), border_color = FG }
        or { bg_opa = 255, border_width = 0 })
    end
    log.info("A pressed")
  end
end
