-- Patterns: animated LVGL patterns (orbits, ripple tiles, rings, equaliser, spinner, test card), all lvgl.Anim. A = next, B = previous; the Speed dial can be any hardware (Connections).
local h = lvgl.bind("main")
local s = screens.get("main")
local W, H = h.HOR_RES(), h.VER_RES()
local M = math.min(W, H)
local paper = s.scheme == "light" -- e-paper: every LVGL refresh is a slow e-paper refresh
local mono = s.depth == 1         -- 1-bit OLED or e-paper: a pixel is lit or it isn't
local small = W < 160 or H < 160
local tiny = M < 80               -- 128x64, 128x32
local PCT, floor, sin, cos, sqrt, pi = lvgl.PCT, math.floor, math.sin, math.cos, math.sqrt, math.pi

local speed = dial.new("speed", { min = 1, max = 20, start = 6 })

local BG = paper and 0xFFFFFF or 0x0B0C12
local FG = paper and 0x000000 or 0xFFFFFF
h:set_theme {
  screen = { bg_color = BG, bg_opa = 255 },
  object = { bg_opa = 0, border_width = 0, pad_all = 0, radius = 0 },
  label = { text_color = FG, text_font = lvgl.Font("montserrat", small and 14 or 16) },
}

-- Colours: on a 1-bit panel only "lit" survives, so marks are FG and faint guides vanish.
local function hsv(hue, sat, v)
  hue = hue % 360
  local c = v * sat
  local x = c * (1 - math.abs((hue / 60) % 2 - 1))
  local r, g, b
  if hue < 60 then r, g, b = c, x, 0
  elseif hue < 120 then r, g, b = x, c, 0
  elseif hue < 180 then r, g, b = 0, c, x
  elseif hue < 240 then r, g, b = 0, x, c
  elseif hue < 300 then r, g, b = x, 0, c
  else r, g, b = c, 0, x end
  local m = v - c
  return (floor((r + m) * 255 + 0.5) << 16) | (floor((g + m) * 255 + 0.5) << 8) | floor((b + m) * 255 + 0.5)
end
local function col(c) return mono and FG or c end
local DIM = mono and BG or 0x262B3C -- guides, tracks

-- Speed scales every duration: 6 is the reference speed, 1 is 6x slower, 20 is 3.3x faster.
local curSpeed = 6
local function dur(ms) return math.max(60, floor(ms * 6 / curSpeed)) end

-- Start an Anim; on e-paper jump straight to a still frame instead (para.still, else the end value).
local function anim(obj, para)
  local still = para.still
  para.still = nil
  if paper then
    if para.exec_cb then para.exec_cb(obj, still or para.end_value) end
    return nil
  end
  para.run = para.run ~= false
  return obj:Anim(para)
end
local LOOP = lvgl.ANIM_REPEAT_INFINITE

-- Margin from the edges (rounded panel corners, OLED borders).
local m = math.max(2, M // 12)
local cx, cy = W // 2, H // 2

-- ── patterns: each builds its widgets and anims inside `root` ─────────────

local patterns = {}

-- Orbits: planets on elliptical orbits (circles on square/tall screens), a pulsing sun.
patterns[#patterns + 1] = { name = "Orbits", build = function(root)
  local K = tiny and 3 or 4
  local Rx = math.min(W / 2 - m, (H / 2 - m) * 1.8)
  local Ry = math.min(H / 2 - m, Rx)
  for i = 1, K do
    local rx, ry = Rx * i / K, Ry * i / K
    -- The orbit itself, as a faint polyline (skipped on 1-bit panels).
    if not mono then
      local pts = {}
      for k = 0, 48 do
        local a = k / 48 * 2 * pi
        pts[#pts + 1] = { floor(rx + rx * cos(a) + 0.5), floor(ry + ry * sin(a) + 0.5) }
      end
      root:Line { points = pts, x = floor(cx - rx), y = floor(cy - ry), line_color = DIM, line_width = 1 }
    end
    local n = (i == 1) and 1 or (i == K and 3 or 2)
    local d = math.max(3, floor(M / (tiny and 14 or 22)) + (i % 2) * 2)
    local color = col(hsv(190 + i * 45, 0.6, 1))
    local dir = (i % 2 == 0) and -1 or 1
    for j = 0, n - 1 do
      local dot = root:Object { w = d, h = d, radius = lvgl.RADIUS_CIRCLE, bg_color = color, bg_opa = 255,
        align = lvgl.ALIGN.CENTER }
      local phase = floor(j * 3600 / n + i * 700)
      anim(dot, {
        start_value = phase, end_value = phase + dir * 3600,
        duration = dur(1400 * i ^ 1.5), repeat_count = LOOP, -- outer planets are slower (Kepler-ish)
        exec_cb = function(o, v)
          local a = v / 1800 * pi
          o:set { translate_x = floor(cos(a) * rx + 0.5), translate_y = floor(sin(a) * ry + 0.5) }
        end,
      })
    end
  end
  local S = math.max(6, M // 7)
  local sun = root:Object { w = S, h = S, radius = lvgl.RADIUS_CIRCLE, bg_color = col(0xFFB347), bg_opa = 255,
    align = lvgl.ALIGN.CENTER, transform_pivot_x = S // 2, transform_pivot_y = S // 2 }
  anim(sun, {
    start_value = 200, end_value = 300, duration = dur(900), playback_time = dur(900),
    path = "ease_in_out", repeat_count = LOOP, still = 256,
    exec_cb = function(o, v) o:set { transform_scale_x = v, transform_scale_y = v } end,
  })
end }

-- Tiles: a grid of rounded squares; a ripple of size and opacity spreads out from the centre.
patterns[#patterns + 1] = { name = "Tiles", build = function(root)
  local aw, ah = W - 2 * m, H - 2 * m
  local cell = math.max(6, math.ceil(sqrt(aw * ah / 72)))
  local cols, rows = math.max(1, aw // cell), math.max(1, ah // cell)
  local gap = math.max(1, cell // 6)
  local t = cell - gap
  local ox, oy = (W - cols * cell + gap) // 2, (H - rows * cell + gap) // 2
  local cc, rc = (cols - 1) / 2, (rows - 1) / 2
  local maxd = sqrt(cc * cc + rc * rc) + 0.001
  local half = dur(700)
  for r = 0, rows - 1 do
    for c = 0, cols - 1 do
      local d = sqrt((c - cc) ^ 2 + (r - rc) ^ 2)
      local tile = root:Object { x = ox + c * cell, y = oy + r * cell, w = t, h = t, radius = math.max(1, t // 4),
        bg_color = col(hsv(170 + d / maxd * 140, 0.7, 1)), bg_opa = 255,
        transform_pivot_x = t // 2, transform_pivot_y = t // 2 }
      anim(tile, {
        start_value = 0, end_value = 255, duration = half, playback_time = half,
        path = "ease_in_out", repeat_count = LOOP,
        delay = floor(d / maxd * 3 * half), -- the ripple: about 1.5 wavelengths across the grid
        still = floor((cos(d / maxd * 3 * pi) + 1) * 127),
        exec_cb = function(o, v)
          local k = 96 + v * 160 // 255
          o:set { bg_opa = 40 + v * 215 // 255, transform_scale_x = k, transform_scale_y = k }
        end,
      })
    end
  end
end }

-- Rings: concentric arcs, each a short indicator turning at its own speed and direction.
patterns[#patterns + 1] = { name = "Rings", build = function(root)
  local N = tiny and 3 or 5
  local outer = M - 2 * m
  local step = outer / (2 * N)
  local width = math.max(2, floor(step * 0.6))
  for i = 0, N - 1 do
    local size = floor(outer - 2 * i * step)
    local arc = root:Arc { w = size, h = size, align = lvgl.ALIGN.CENTER, arc_width = width,
      bg_start_angle = 0, bg_end_angle = 360, start_angle = 0, end_angle = 70 + i * 35, rotation = 0 }
    arc:set_style({ arc_color = DIM }, lvgl.PART.MAIN)
    arc:set_style({ arc_color = col(hsv(330 - i * 40, 0.75, 1)) }, lvgl.PART.INDICATOR)
    arc:set_style({ bg_opa = 0 }, lvgl.PART.KNOB)
    local dir = (i % 2 == 0) and 1 or -1
    anim(arc, {
      start_value = dir > 0 and 0 or 360, end_value = dir > 0 and 360 or 0,
      duration = dur(2200 + i * 900), repeat_count = LOOP, still = (i * 67) % 360,
      exec_cb = function(o, v) o:set { rotation = v } end,
    })
  end
end }

-- Bars: an equaliser; each bar breathes up and down with its own height and tempo.
patterns[#patterns + 1] = { name = "Bars", build = function(root)
  local aw, ah = W - 2 * m, H - 2 * m
  local n = math.max(6, math.min(24, aw // (small and 8 or 14)))
  local pitch = aw // n
  local gap = math.max(1, pitch // 4)
  local bw = pitch - gap
  local ox = (W - n * pitch + gap) // 2
  local lo = math.max(2, ah // 10)
  for i = 0, n - 1 do
    local f = ((i * 37 + 11) % 23) / 22 -- deterministic "random" so a rebuild looks the same
    local g = ((i * 53 + 5) % 19) / 18
    local top = floor(lo + (ah - lo) * (0.45 + 0.55 * f))
    local bar = root:Object { x = ox + i * pitch, y = -m, align = lvgl.ALIGN.BOTTOM_LEFT, w = bw, h = lo,
      radius = math.max(1, bw // 4), bg_opa = 255,
      bg_color = col(hsv(200 + i * 140 / n, 0.7, 0.9)),
      bg_grad_color = col(hsv(320 + i * 40 / n, 0.6, 1)), bg_grad_dir = mono and lvgl.GRAD_DIR.NONE or lvgl.GRAD_DIR.VER }
    local t = dur(380 + 520 * g)
    anim(bar, {
      start_value = lo, end_value = top, duration = t, playback_time = t,
      path = "ease_in_out", repeat_count = LOOP, delay = (i * 97) % 300,
      exec_cb = function(o, v) o:set { h = v } end,
    })
  end
end }

-- Spinner: an arc whose head and tail chase each other round, like lv_spinner, plus pulsing dots.
patterns[#patterns + 1] = { name = "Spinner", build = function(root)
  local size = M - 2 * m
  local width = math.max(3, size // 10)
  local arc = root:Arc { w = size, h = size, align = lvgl.ALIGN.CENTER, arc_width = width,
    bg_start_angle = 0, bg_end_angle = 360, start_angle = 0, end_angle = 0, rotation = 270 }
  arc:set_style({ arc_color = DIM }, lvgl.PART.MAIN)
  arc:set_style({ arc_color = col(0x5AC8FA) }, lvgl.PART.INDICATOR)
  arc:set_style({ bg_opa = 0 }, lvgl.PART.KNOB)
  local T = dur(1300)
  -- The head runs ahead; the tail follows a quarter period later. Both ease, so the arc stretches
  -- and shrinks; a slow rotation on top keeps it from looking like it resets.
  anim(arc, { start_value = 0, end_value = 360, duration = T, path = "ease_in_out", repeat_count = LOOP,
    still = 300, exec_cb = function(o, v) o:set { end_angle = v } end })
  anim(arc, { start_value = 0, end_value = 360, duration = T, path = "ease_in_out", repeat_count = LOOP,
    delay = T // 4, still = 40, exec_cb = function(o, v) o:set { start_angle = v } end })
  anim(arc, { start_value = 270, end_value = 630, duration = T * 3, repeat_count = LOOP,
    still = 270, exec_cb = function(o, v) o:set { rotation = v % 360 } end })
  if size >= 60 then
    local d = math.max(4, size // 14)
    for j = 0, 2 do
      local dot = root:Object { w = d, h = d, radius = lvgl.RADIUS_CIRCLE, bg_color = col(0xECECF2), bg_opa = 255,
        align = lvgl.ALIGN.CENTER, x = (j - 1) * d * 2 }
      anim(dot, { start_value = 30, end_value = 255, duration = dur(450), playback_time = dur(450),
        path = "ease_in_out", repeat_count = LOOP, delay = j * dur(150), still = 255,
        exec_cb = function(o, v) o:set { bg_opa = v } end })
    end
  end
end }

-- Test card: grid, frame, circle, diagonals, colour and grey bars, the resolution. No motion.
patterns[#patterns + 1] = { name = "Test card", still = true, build = function(root)
  local stepG = mono and 16 or (small and 10 or 20)
  local GRID = mono and FG or 0x2F6B3A
  -- One serpentine polyline per direction draws the whole grid (its turns fall on the frame).
  local hp, vp = {}, {}
  local y, flip = 0, false
  while y <= H - 1 do
    hp[#hp + 1] = { flip and W - 1 or 0, y }
    hp[#hp + 1] = { flip and 0 or W - 1, y }
    y, flip = y + stepG, not flip
  end
  local x
  x, flip = 0, false
  while x <= W - 1 do
    vp[#vp + 1] = { x, flip and H - 1 or 0 }
    vp[#vp + 1] = { x, flip and 0 or H - 1 }
    x, flip = x + stepG, not flip
  end
  if not mono or not tiny then
    root:Line { points = hp, line_color = GRID, line_width = 1 }
    root:Line { points = vp, line_color = GRID, line_width = 1 }
  end
  if not mono then
    -- Colour bars across the top, a grey ramp along the bottom.
    local bars = { 0xFFFFFF, 0xFFFF00, 0x00FFFF, 0x00FF00, 0xFF00FF, 0xFF0000, 0x0000FF }
    local bh = math.max(6, H // 8)
    for i, c in ipairs(bars) do
      local x0 = (i - 1) * W // #bars
      root:Object { x = x0, y = m, w = i * W // #bars - x0, h = bh, bg_color = c, bg_opa = 255 }
    end
    for i = 0, 7 do
      local x0 = i * W // 8
      local v = floor(i * 255 / 7)
      root:Object { x = x0, y = H - m - bh, w = (i + 1) * W // 8 - x0, h = bh, bg_color = (v << 16) | (v << 8) | v, bg_opa = 255 }
    end
  end
  root:Object { w = W, h = H, border_width = 1, border_color = FG, bg_opa = 0 }
  local D = M - 8
  root:Object { w = D, h = D, align = lvgl.ALIGN.CENTER, radius = lvgl.RADIUS_CIRCLE, border_width = 1,
    border_color = FG, bg_opa = 0 }
  root:Line { points = { { 0, 0 }, { W - 1, H - 1 } }, line_color = col(0xFF4040), line_width = 1 }
  root:Line { points = { { W - 1, 0 }, { 0, H - 1 } }, line_color = col(0x40FF40), line_width = 1 }
  local res = root:Label { text = W .. "x" .. H, align = lvgl.ALIGN.CENTER, y = tiny and 0 or -10,
    text_font = lvgl.Font("montserrat", tiny and 14 or (small and 20 or 24)),
    bg_color = BG, bg_opa = 255, pad_hor = 4, pad_ver = 1 }
  if not tiny then
    root:Label { text = (s.depth == 16 and "16-bit" or "1-bit") .. " " .. s.scheme,
      text_font = lvgl.Font("montserrat", 14), bg_color = BG, bg_opa = 255, pad_hor = 4 }
      :align_to { base = res, type = lvgl.ALIGN.OUT_BOTTOM_MID, y_ofs = 4 }
  end
end }

-- ── switching ──────────────────────────────────────────────────────────────

local index, root = 1, nil

-- A caption that fades out after a moment (on e-paper it stays).
local function caption(text)
  local l = root:Label { text = text, align = lvgl.ALIGN.BOTTOM_MID, y = -math.max(2, m // 2),
    text_font = lvgl.Font("montserrat", small and 14 or 16),
    bg_color = BG, bg_opa = 220, radius = 4, pad_hor = 6, pad_ver = 2 }
  anim(l, { start_value = 255, end_value = 0, delay = 900, duration = 600, early_apply = false,
    still = 255, exec_cb = function(o, v) o:set { opa = v } end })
end

-- Deleting the container deletes every widget in it, and an Anim whose object is gone drops itself.
local function build(i, why)
  index = (i - 1) % #patterns + 1
  if root then root:delete() end
  root = h.Object { w = PCT(100), h = PCT(100), pad_all = 0, bg_opa = 0, border_width = 0, radius = 0 }
  local p = patterns[index]
  p.build(root)
  caption(why == "speed" and ("speed " .. curSpeed) or p.name)
  if why ~= "speed" then log.info("pattern: " .. p.name) end
end

function init(ctx)
  curSpeed = floor(speed:value() + 0.5)
  build(1)
end

-- on_tick only watches the dial: a new speed rebuilds the pattern with retimed Anims.
function on_tick(ctx, dt_ms)
  local v = floor(speed:value() + 0.5)
  if v ~= curSpeed then
    curSpeed = v
    if not paper and not patterns[index].still then build(index, "speed") end
  end
end

function on_event(ctx, e)
  if e.name == "tap" then build(index + (e.data.index == 0 and 1 or -1)) end
end
