-- Touch: tap and drag on the screen. A drag draws a trail, each tap leaves a ring that grows and fades; A clears.
-- @needs touch motion
local g = lgfx.bind("main")
local s = screens.get("main")
local W, H = g:width(), g:height()
local light = s.scheme == "light"
local BG = light and 0xFFFFFF or 0x000000
local FG = light and 0x000000 or 0xFFFFFF
local color = s.depth == 16
local PALETTE = { 0xFF5E7E, 0x5AC8FA, 0xFFD166, 0x7CFFB2, 0xC77DFF }
local TRAIL = color and 0x5AC8FA or FG
local RING_MS = 1200

local taps = 0
local trail = {}   -- { {x, y}, ... } of the current drag
local rings = {}   -- { x, y, born_ms, colour }
local now = 0
local dirty = true

local function draw()
  g:fillScreen(BG)
  for i = 2, #trail do
    g:drawLine(trail[i - 1][1], trail[i - 1][2], trail[i][1], trail[i][2], TRAIL)
  end
  for _, r in ipairs(rings) do
    local age = (now - r[3]) / RING_MS
    g:drawCircle(r[1], r[2], math.floor(6 + age * math.min(W, H) / 5), r[4])
  end
  local t = touchscreen.read()
  if t.pressed then g:fillCircle(t.x, t.y, 6, FG) end
  g:setTextColor(FG)
  g:setTextSize(2)
  g:setTextDatum(lgfx.MC_DATUM)
  -- Round glass: the middle is always visible; a rectangle: the top edge.
  g:drawString("taps " .. taps, W // 2, s.shape == "round" and H // 2 or 16)
  g:flip()
  dirty = false
end

function init(ctx)
  now = ctx.time_ms
  log.info("touch me: " .. W .. "x" .. H)
  draw()
end

function on_event(ctx, e)
  now = ctx.time_ms
  local p = e.data
  if e.name == "touch_down" then
    trail = { { p.x, p.y } }
  elseif e.name == "touch_move" then
    if #trail < 300 then trail[#trail + 1] = { p.x, p.y } end
  elseif e.name == "touch_tap" then
    taps = taps + 1
    rings[#rings + 1] = { p.x, p.y, now, color and PALETTE[(taps - 1) % #PALETTE + 1] or FG }
    log.info("tap " .. taps .. " at " .. p.x .. "," .. p.y)
  elseif e.name == "tap" and e.data.index == 0 then
    taps, trail, rings = 0, {}, {}
  else
    return
  end
  dirty = true
end

function on_tick(ctx)
  now = ctx.time_ms
  for i = #rings, 1, -1 do
    if now - rings[i][3] > RING_MS then table.remove(rings, i) end
  end
  if dirty or #rings > 0 then draw() end
end
