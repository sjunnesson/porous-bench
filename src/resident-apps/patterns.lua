-- Patterns: animated LVGL patterns. A = next, B = previous.
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

-- Speed scales the clock the patterns follow: 6 is the reference speed, 1 is 6x slower, 20 is 3.3x faster.
local curSpeed = 6
local ticks, ticks_diff = time.ticks_ms, time.ticks_diff
local LOOP = lvgl.ANIM_REPEAT_INFINITE

-- A pattern moves everything it has in one call, frame(t), t being its own time in ms: one Anim on
-- its root calls it at most every FRAME ms, however many objects there are. An Anim per object would
-- run Lua for each one 66 times a second on a board whose LVGL refreshes every 15 ms. It follows the
-- clock, so a frame that ran late only moves things further. E-paper gets the frame at `still`.
local FRAME = 30
local function drive(root, frame, still)
  if paper then return frame(still or 0) end
  frame(0)
  local last, late, t = ticks(), 0, 0
  root:Anim { start_value = 0, end_value = 1000, duration = 1000, repeat_count = LOOP, run = true,
    exec_cb = function()
      local now = ticks()
      local d = ticks_diff(now, last)
      if d + late >= FRAME then -- this comes on a 5 ms grid: what a frame ran over comes off the next
        last, late, t = now, math.min(d + late - FRAME, FRAME), t + d * curSpeed
        frame(t // 6)
      end
    end }
end

-- What a frame may repaint. LVGL repaints each object that changes, whole, and on a big screen more
-- than this a frame can't hold 30 fps; past 32 changed areas it gives up and repaints the whole
-- screen, which is why a growing object counts double. Small screens never reach it.
local PIXELS, AREAS = 45000, 14

-- 0 to 255 and back every T ms, easing at both ends. A table: a pattern asks for this per object.
local EASE = {}
for i = 0, 64 do EASE[i] = floor((1 - cos(pi * i / 64)) * 127.5 + 0.5) end
local function breathe(t, T)
  local p = t % T
  if p * 2 > T then p = T - p end
  return EASE[p * 128 // T]
end

-- Margin from the edges (rounded panel corners, OLED borders).
local m = math.max(2, M // 12)
local cx, cy = W // 2, H // 2

-- ── patterns: each builds its widgets and anims inside `root` ─────────────

local patterns = {}

-- Orbits: planets on elliptical orbits (circles on square/tall screens), a pulsing sun.
patterns[#patterns + 1] = { name = "Orbits", build = function(root)
  local K = tiny and 3 or 4
  local planets = {}
  local Rx = math.min(W / 2 - m, (H / 2 - m) * 1.8)
  local Ry = math.min(H / 2 - m, Rx)
  for i = 1, K do
    local rx, ry = Rx * i / K, Ry * i / K
    -- The orbit itself, faint (skipped on 1-bit panels), in short lines. LVGL draws every segment of a
    -- line whenever anything touches its bounding box, and a planet is always on one: a whole orbit
    -- as one line cost ~50 ms a frame. This way only the pieces under a planet are redrawn.
    if not mono then
      for sec = 0, 11 do
        local pts, x0, y0 = {}, 1e9, 1e9
        for k = sec * 4, sec * 4 + 4 do
          local a = k / 48 * 2 * pi
          local px, py = floor(cx + rx * cos(a) + 0.5), floor(cy + ry * sin(a) + 0.5)
          pts[#pts + 1] = { px, py }
          x0, y0 = math.min(x0, px), math.min(y0, py)
        end
        for _, p in ipairs(pts) do p[1], p[2] = p[1] - x0, p[2] - y0 end
        root:Line { points = pts, x = x0, y = y0, line_color = DIM, line_width = 1 }
      end
    end
    local n = (i == 1) and 1 or (i == K and 3 or 2)
    local d = math.max(3, floor(M / (tiny and 14 or 22)) + (i % 2) * 2)
    local color = col(hsv(190 + i * 45, 0.6, 1))
    local dir = (i % 2 == 0) and -1 or 1
    for j = 0, n - 1 do
      local dot = root:Object { w = d, h = d, radius = lvgl.RADIUS_CIRCLE, bg_color = color, bg_opa = 255,
        align = lvgl.ALIGN.CENTER }
      planets[#planets + 1] = { o = dot, rx = rx, ry = ry, phase = (j / n + i * 7 / 36) * 2 * pi,
        speed = dir * 2 * pi / (1400 * i ^ 1.5) } -- outer planets are slower (Kepler-ish)
    end
  end
  local S = math.max(6, M // 7)
  local sun = root:Object { x = cx - S // 2, y = cy - S // 2, w = S, h = S, radius = lvgl.RADIUS_CIRCLE, bg_color = col(0xFFB347), bg_opa = 255 }
  local p, ps, was = {}, {}, S -- reused each frame: a table a call would be garbage, and cost twice the call
  drive(root, function(t)
    for _, q in ipairs(planets) do
      local a = q.phase + t * q.speed
      local x, y = floor(cos(a) * q.rx + 0.5), floor(sin(a) * q.ry + 0.5)
      if x ~= q.x or y ~= q.y then
        q.x, q.y, p.translate_x, p.translate_y = x, y, x, y
        q.o:set(p)
      end
    end
    -- The sun pulses by its size, not by transform_scale: scaling makes LVGL draw it into a layer and
    -- transform that, ~40 ms a frame on the Guition. Even sizes keep it centred.
    local d = S * (200 + breathe(t, 1800) * 100 // 255) // 256 & ~1
    if d ~= was then
      was, ps.x, ps.y, ps.w, ps.h = d, cx - d // 2, cy - d // 2, d, d
      sun:set(ps)
    end
  end)
end }

-- Tiles: a grid of rounded squares; a ripple of size and shade spreads out from the centre. Tiles the
-- same distance from it always look the same, so they share a Style: one call changes them all, and
-- only when their step changes (a Style's set doesn't repaint on a board: each tile is invalidated).
-- No transform_scale: on this many objects LVGL's layers overflow the stack and the board reboots.
-- Each frame paints as many rings as PIXELS allow, and the rest catch up. The Styles are kept for good:
-- once one is garbage collected, every frame after it takes ~14 ms more on the Guition (measured; why
-- isn't known), so going back to Tiles reuses them.
local tileStyles = {}
patterns[#patterns + 1] = { name = "Tiles", build = function(root)
  local aw, ah = W - 2 * m, H - 2 * m
  local cell = math.max(6, floor(sqrt(aw * ah / 64)))
  local cols, rows = math.max(1, aw // cell), math.max(1, ah // cell)
  local gap = math.max(1, cell // 6)
  local t = cell - gap
  local ox, oy = (W - cols * cell + gap) // 2, (H - rows * cell + gap) // 2
  local cc, rc = (cols - 1) / 2, (rows - 1) / 2
  local maxd = sqrt(cc * cc + rc * rc) + 0.001
  local rings, byDist = {}, {}
  local half = 700
  local STEPS = 16
  for r = 0, rows - 1 do
    for c = 0, cols - 1 do
      local d = sqrt((c - cc) ^ 2 + (r - rc) ^ 2)
      local key = floor(d * 64)
      local ring = byDist[key]
      if not ring then
        ring = { d = d, n = 0, tiles = {}, delay = floor(d / maxd * 3 * half), shades = {} }
        local base = hsv(170 + d / maxd * 140, 0.7, 1)
        for q = 0, STEPS - 1 do -- the shade as a colour: a solid fill costs less than a translucent one
          local opa = 40 + q * 215 // (STEPS - 1)
          local mix = function(sh)
            local a, b = (base >> sh) & 255, (BG >> sh) & 255
            return (b + (a - b) * opa // 255) << sh
          end
          ring.shades[q] = col(mix(16) | mix(8) | mix(0))
        end
        rings[#rings + 1] = ring
        byDist[key] = ring
        tileStyles[#rings] = tileStyles[#rings] or lvgl.Style {}
        ring.style = tileStyles[#rings]
        ring.style:set { bg_color = ring.shades[0], transform_width = 0, transform_height = 0 }
      end
      ring.n = ring.n + 1
      local tile = root:Object { x = ox + c * cell, y = oy + r * cell, w = t, h = t, radius = math.max(1, t // 4), bg_opa = 255 }
      tile:add_style(ring.style)
      ring.tiles[ring.n] = tile
    end
  end
  local maxTiles = math.min(AREAS, math.max(1, PIXELS // (t * t)))
  local p, at = {}, 1
  drive(root, function(now)
    local spent, count = 0, #rings
    for _ = 1, count do
      local ring = rings[at]
      local v = breathe(now - ring.delay, 2 * half)
      local q = v * STEPS // 256
      if q ~= ring.q then
        if spent > 0 and spent + ring.n > maxTiles then break end
        spent, ring.q = spent + ring.n, q
        local inset = -(t * 160 * (255 - v) // 65280) // 2
        p.bg_color, p.transform_width, p.transform_height = ring.shades[q], inset, inset
        ring.style:set(p)
        for i = 1, ring.n do ring.tiles[i]:invalidate() end
      end
      at = at % count + 1
    end
  end, half * 2 // 3)
end }

-- Rings: concentric arcs, each a short indicator turning at its own speed and direction.
patterns[#patterns + 1] = { name = "Rings", build = function(root)
  local N = tiny and 3 or 5
  local outer = M - 2 * m
  local step = outer / (2 * N)
  local width = math.max(2, floor(step * 0.6))
  local arcs = {}
  for i = 0, N - 1 do
    local size = floor(outer - 2 * i * step)
    local arc = root:Arc { w = size, h = size, align = lvgl.ALIGN.CENTER, arc_width = width,
      bg_start_angle = 0, bg_end_angle = 360, start_angle = 0, end_angle = 70 + i * 35, rotation = 0 }
    -- No track and square ends: every arc under a repainted area is masked again even where it shows
    -- nothing there, and a round end repaints further. The two took this from 21 fps to 32 on the Guition.
    arc:set_style({ arc_opa = 0 }, lvgl.PART.MAIN)
    arc:set_style({ arc_color = col(hsv(330 - i * 40, 0.75, 1)), arc_rounded = 0 }, lvgl.PART.INDICATOR)
    arc:set_style({ bg_opa = 0, pad_all = 0 }, lvgl.PART.KNOB)
    arcs[i + 1] = { o = arc, span = 70 + i * 35, deg = ((i % 2 == 0) and 360 or -360) / (2200 + i * 900), start = i * 67 }
  end
  -- Turned by its two ends, not by `rotation`: LVGL then repaints only where each end moved, where
  -- rotation repaints the whole ring and everything under it.
  local p = {}
  drive(root, function(t)
    for _, q in ipairs(arcs) do
      local a = floor(q.start + t * q.deg) % 360
      if a ~= q.a then
        q.a, p.start_angle, p.end_angle = a, a, (a + q.span) % 360
        q.o:set(p)
      end
    end
  end)
end }

-- Bars: an equaliser; each bar breathes up and down with its own height and tempo. A bar never changes:
-- it is a still, full-height gradient, and opaque covers in the background's colour hide what's above
-- its level. Covers hang from the top in fixed sections, and only the one at the level changes, by its
-- height alone. So what repaints is never taller than a section. Moving whole bars repainted half the
-- screen in 40-row strips, and each one's y and h together marked 4 areas: 16 bars pass LVGL's limit of
-- 32 and it repaints the whole screen. An object with an `align` costs 3x as much to resize, too.
patterns[#patterns + 1] = { name = "Bars", build = function(root)
  local aw, ah = W - 2 * m, H - 2 * m
  local n = math.max(6, math.min(16, aw // (small and 8 or 14)))
  local pitch = aw // n
  local gap = math.max(1, pitch // 4)
  local bw = pitch - gap
  local ox = (W - n * pitch + gap) // 2
  local lo = math.max(2, ah // 10)
  local SECTIONS = 6
  local sh = (ah + SECTIONS - 1) // SECTIONS
  local bars = {}
  for i = 0, n - 1 do
    local f = ((i * 37 + 11) % 23) / 22 -- deterministic "random" so a rebuild looks the same
    local g = ((i * 53 + 5) % 19) / 18
    local x = ox + i * pitch
    root:Object { x = x, y = m, w = bw, h = ah, radius = math.max(1, bw // 4), bg_opa = 255,
      bg_color = col(hsv(200 + i * 140 / n, 0.7, 0.9)),
      bg_grad_color = col(hsv(320 + i * 40 / n, 0.6, 1)), bg_grad_dir = mono and lvgl.GRAD_DIR.NONE or lvgl.GRAD_DIR.VER }
    local b = { covers = {}, covered = 0, T = 2 * floor(380 + 520 * g), delay = (i * 97) % 300,
      top = floor(lo + (ah - lo) * (0.45 + 0.55 * f)) - lo }
    for k = 1, SECTIONS do
      b.covers[k] = root:Object { x = x, y = m + (k - 1) * sh, w = bw, h = 0, bg_color = BG, bg_opa = 255 }
    end
    bars[i + 1] = b
  end
  -- AREAS covers a frame, taking turns: a cover changing height marks up to 2 areas, and one more than
  -- LVGL's 32 repaints the whole screen, which held the Guition to 4.8 fps.
  local p, at = {}, 1
  drive(root, function(t)
    local spent = 0
    for _ = 1, n do
      local b = bars[at]
      local covered = ah - lo - b.top * breathe(t - b.delay, b.T) // 255
      if covered ~= b.covered then
        if spent >= AREAS then break end
        local from, to = b.covered // sh + 1, covered // sh + 1
        b.covered = covered
        for k = math.min(from, to), math.max(from, to) do
          local v = math.max(0, math.min(sh, covered - (k - 1) * sh))
          if v ~= (b[k] or 0) then
            b[k], p.h, spent = v, v, spent + 1
            b.covers[k]:set(p)
          end
        end
      end
      at = at % n + 1
    end
  end, 450)
end }

-- Spinner: an arc whose head and tail chase each other round, like lv_spinner, plus pulsing dots.
patterns[#patterns + 1] = { name = "Spinner", build = function(root)
  local size = M - 2 * m
  local width = math.max(3, size // 10)
  local arc = root:Arc { w = size, h = size, align = lvgl.ALIGN.CENTER, arc_width = width,
    bg_start_angle = 0, bg_end_angle = 360, start_angle = 0, end_angle = 0, rotation = 0 }
  arc:set_style({ arc_color = DIM }, lvgl.PART.MAIN)
  arc:set_style({ arc_color = col(0x5AC8FA) }, lvgl.PART.INDICATOR)
  arc:set_style({ bg_opa = 0 }, lvgl.PART.KNOB)
  -- The head runs ahead; the tail follows a quarter period later. Both ease, so the arc stretches and
  -- shrinks; a slow turn on top keeps it from looking like it resets. Its two ends are all that move,
  -- so that's all LVGL repaints.
  local T = 1300
  local dots, pd = {}, {}
  if size >= 60 then
    local d = math.max(4, size // 14)
    for j = 0, 2 do
      dots[j + 1] = root:Object { w = d, h = d, radius = lvgl.RADIUS_CIRCLE, bg_color = col(0xECECF2), bg_opa = 255,
        align = lvgl.ALIGN.CENTER, x = (j - 1) * d * 2 }
    end
  end
  local p, was = {}, {}
  drive(root, function(t)
    local turn = 270 + (t * 360 // (3 * T))
    local s, e = (turn + EASE[((t - T // 4) % T) * 64 // T] * 360 // 255) % 360, (turn + EASE[(t % T) * 64 // T] * 360 // 255) % 360
    if s ~= p.start_angle or e ~= p.end_angle then
      p.start_angle, p.end_angle = s, e
      arc:set(p)
    end
    for j, dot in ipairs(dots) do
      local v = (30 + breathe(t - (j - 1) * 150, 900) * 225 // 255) & ~15
      if v ~= was[j] then
        was[j], pd.bg_opa = v, v
        dot:set(pd)
      end
    end
  end, T * 3 // 5)
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
local label
local function caption(text)
  if label then label:delete() end
  label = root:Label { text = text, align = lvgl.ALIGN.BOTTOM_MID, y = -math.max(2, m // 2),
    text_font = lvgl.Font("montserrat", small and 14 or 16),
    bg_color = BG, bg_opa = 220, radius = 4, pad_hor = 6, pad_ver = 2 }
  if not paper then
    label:Anim { start_value = 255, end_value = 0, delay = 900, duration = 600, early_apply = false, run = true,
      exec_cb = function(o, v) o:set { opa = v } end }
  end
end

-- Deleting the container deletes every widget in it, and an Anim whose object is gone drops itself.
local function build(i)
  index = (i - 1) % #patterns + 1
  if root then root:delete() end
  root = h.Object { w = PCT(100), h = PCT(100), pad_all = 0, bg_opa = 0, border_width = 0, radius = 0 }
  root:clear_flag(lvgl.FLAG.SCROLLABLE) -- it never scrolls, and working that out takes ~10% of a frame
  label = nil
  local p = patterns[index]
  p.build(root)
  caption(p.name)
  log.info("pattern: " .. p.name)
end

function init(ctx)
  curSpeed = floor(speed:value() + 0.5)
  build(1)
end

-- on_tick only watches the dial: the patterns follow curSpeed's clock from their next frame.
function on_tick(ctx, dt_ms)
  local v = floor(speed:value() + 0.5)
  if v ~= curSpeed then
    curSpeed = v
    if not paper and not patterns[index].still then caption("speed " .. v) end
  end
end

function on_event(ctx, e)
  if e.name == "tap" then build(index + (e.data.index == 0 and 1 or -1)) end
end
