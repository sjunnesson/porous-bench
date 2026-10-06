-- Patterns: full-screen generative patterns. A = next, B = previous; the Speed dial can be any hardware (Controls).
local g = lgfx.bind("main")
local s = screens.get("main")
local W, H = g:width(), g:height()
local light = s.scheme == "light"
local BG = light and 0xFFFFFF or 0x000000
local FG = light and 0x000000 or 0xFFFFFF

local speed = dial.new("speed", { min = 1, max = 20, start = 6 })

-- Pixel-level patterns are drawn in blocks: on_tick runs 10 times a second, and every call into
-- lgfx costs time, so a block size keeps each frame to a few thousand rectangles.
local mono = s.depth == 1
local BS = mono and 2 or math.max(4, math.floor(math.sqrt(W * H / 3500)))
local sin, floor, sqrt = math.sin, math.floor, math.sqrt
-- 1-bit screens light a pixel at 50% brightness, so mid-tone colours would all go dark. Ordered
-- (Bayer) dithering turns brightness into a density of lit blocks instead.
local BAYER = { 0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5 }

local function hsv(h, sat, v)
  h = h % 360
  v = v < 0 and 0 or (v > 1 and 1 or v)
  local c = v * sat
  local x = c * (1 - math.abs((h / 60) % 2 - 1))
  local r, gr, b
  if h < 60 then r, gr, b = c, x, 0
  elseif h < 120 then r, gr, b = x, c, 0
  elseif h < 180 then r, gr, b = 0, c, x
  elseif h < 240 then r, gr, b = 0, x, c
  elseif h < 300 then r, gr, b = x, 0, c
  else r, gr, b = c, 0, x end
  local m = v - c
  return (floor((r + m) * 255 + 0.5) << 16) | (floor((gr + m) * 255 + 0.5) << 8) | floor((b + m) * 255 + 0.5)
end

-- Fill the screen block by block with f(x, y) → colour, sampled at each block's centre.
local function blocks(f)
  for y = 0, H - 1, BS do
    for x = 0, W - 1, BS do
      local c = f(x + BS / 2, y + BS / 2)
      if mono then
        local lum = (0.3 * (c >> 16) + 0.59 * ((c >> 8) & 0xFF) + 0.11 * (c & 0xFF)) / 255
        local threshold = (BAYER[((y // BS) % 4) * 4 + (x // BS) % 4 + 1] + 0.5) / 16
        c = lum > threshold and FG or BG
      end
      g:fillRect(x, y, BS, BS, c)
    end
  end
end

local stars, cells, cols, rows = {}, {}, 0, 0
local CELL = 4
local lastGen = 0

local patterns = {
  {
    name = "Plasma",
    draw = function(t)
      local k, cx, cy = 0.06, W / 2, H / 2
      blocks(function(x, y)
        local v = sin(x * k + t) + sin((y * k + t) * 0.7) + sin((x + y) * k * 0.6 + t * 1.3)
          + sin(sqrt((x - cx) ^ 2 + (y - cy) ^ 2) * k)
        return hsv(v * 90 + t * 40, 0.9, 0.5 + v / 8)
      end)
    end,
  },
  {
    name = "Rainbow",
    draw = function(t)
      blocks(function(x, y) return hsv((x + y) * 1.5 - t * 120, 1, 1) end)
    end,
  },
  {
    name = "Checker",
    draw = function(t)
      local sz = 12
      local ox, oy = floor(t * 20) % (sz * 2), floor(t * 9) % (sz * 2)
      for y = -sz * 2, H - 1, sz do
        for x = -sz * 2, W - 1, sz do
          local on = ((x + y) // sz) % 2 == 1
          g:fillRect(x + ox, y + oy, sz, sz, on and FG or BG)
        end
      end
    end,
  },
  {
    name = "Rings",
    draw = function(t)
      local cx = W / 2 + sin(t * 0.8) * W * 0.2
      local cy = H / 2 + math.cos(t * 0.6) * H * 0.2
      blocks(function(x, y)
        local r = sqrt((x - cx) ^ 2 + (y - cy) ^ 2)
        return hsv(200 + r, 0.7, (sin(r * 0.35 - t * 5) + 1) / 2)
      end)
    end,
  },
  {
    name = "Starfield",
    init = function()
      stars = {}
      for i = 1, 140 do stars[i] = { x = math.random() * 2 - 1, y = math.random() * 2 - 1, z = math.random() } end
    end,
    draw = function(t, dt)
      g:fillScreen(0x000000)
      for _, st in ipairs(stars) do
        st.z = st.z - dt * 0.7
        if st.z <= 0.02 then st.x, st.y, st.z = math.random() * 2 - 1, math.random() * 2 - 1, 1 end
        local sx = floor(W / 2 + (st.x / st.z) * W * 0.4)
        local sy = floor(H / 2 + (st.y / st.z) * W * 0.4)
        local b = 1 - st.z
        if b > 0.7 then g:fillRect(sx, sy, 2, 2, 0xFFFFFF)
        else g:drawPixel(sx, sy, hsv(220, 0.3, b + 0.3)) end
      end
    end,
  },
  {
    name = "Life",
    init = function()
      cols, rows = W // CELL, H // CELL
      cells = {}
      for i = 1, cols * rows do cells[i] = math.random() < 0.3 and 1 or 0 end
      lastGen = 0
    end,
    draw = function(t)
      if t - lastGen > 0.08 then
        lastGen = t
        local nxt = {}
        for y = 0, rows - 1 do
          local up, down = ((y - 1) % rows) * cols, ((y + 1) % rows) * cols
          local here = y * cols
          for x = 0, cols - 1 do
            local l, r = (x - 1) % cols + 1, (x + 1) % cols + 1
            local c = x + 1
            local n = cells[up + l] + cells[up + c] + cells[up + r] + cells[here + l] + cells[here + r]
              + cells[down + l] + cells[down + c] + cells[down + r]
            local alive = cells[here + c]
            nxt[here + c] = (n == 3 or (alive == 1 and n == 2)) and 1 or 0
          end
        end
        cells = nxt
      end
      g:fillScreen(BG)
      for y = 0, rows - 1 do
        for x = 0, cols - 1 do
          if cells[y * cols + x + 1] == 1 then
            g:fillRect(x * CELL, y * CELL, CELL - 1, CELL - 1, s.depth == 16 and hsv(x * 4 + y * 2, 0.7, 1) or FG)
          end
        end
      end
    end,
  },
  {
    name = "Test card",
    draw = function()
      g:fillScreen(0x000000)
      for x = 0, W - 1, 10 do g:drawLine(x, 0, x, H - 1, 0x7BEF7B) end
      for y = 0, H - 1, 10 do g:drawLine(0, y, W - 1, y, 0x7BEF7B) end
      g:drawRect(0, 0, W, H, 0xFFFFFF)
      g:drawCircle(W // 2, H // 2, math.min(W, H) // 2 - 4, 0xFFFFFF)
      g:drawLine(0, 0, W - 1, H - 1, 0xFF0000)
      g:drawLine(W - 1, 0, 0, H - 1, 0x00FF00)
      for x = 0, W - 1 do
        local v = floor(x / W * 255)
        g:drawLine(x, H - 12, x, H - 3, (v << 16) | (v << 8) | v)
      end
      g:setTextColor(0xFFFFFF, 0x000000)
      g:setTextSize(1)
      g:setTextDatum(lgfx.MC_DATUM)
      g:drawString(W .. "x" .. H, W // 2, H // 2)
    end,
  },
}

local index, t = 1, 0

local function show(i)
  index = (i - 1) % #patterns + 1
  if patterns[index].init then patterns[index].init() end
  log.info("pattern: " .. patterns[index].name)
end

function init(ctx)
  show(1)
end

function on_tick(ctx, dt_ms)
  local dt = dt_ms / 1000
  t = t + speed:value() * dt * 0.2
  patterns[index].draw(t, dt)
  g:flip()
end

function on_event(ctx, e)
  if e.name == "tap" then show(index + (e.data.index == 0 and 1 or -1)) end
end
