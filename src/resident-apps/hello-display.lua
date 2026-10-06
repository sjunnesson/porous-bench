-- Hello display: device facts, colour bars and a bouncing ball. Adapts to LCD, OLED and e-paper. A changes the colour.
local g = lgfx.bind("main")
local s = screens.get("main")
local W, H = g:width(), g:height()
local color = s.depth == 16
local light = s.scheme == "light"
local BG = light and 0xFFFFFF or 0x000000
local FG = light and 0x000000 or 0xFFFFFF
local slow = light -- e-paper: every flip is a refresh, so move rarely
local compact = H < 48

local hue = 200
local ball = {}
local top, bottom, footerY = 0, 0, 0
local ticks = {}
local wait = 0

-- 0xRRGGBB from hue (degrees), saturation and value (0..1).
local function hsv(h, sat, v)
  h = h % 360
  v = math.max(0, math.min(1, v))
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
  local function byte(u) return math.floor((u + m) * 255 + 0.5) end
  return (byte(r) << 16) | (byte(gr) << 8) | byte(b)
end

local function fit(text, size) -- clip to the screen width (6 px per character)
  local n = W // (6 * size)
  if #text > n then return text:sub(1, n) end
  return text
end

local function backdrop()
  g:fillScreen(BG)
  local headerH = compact and 0 or (H >= 120 and 22 or 16)
  if headerH > 0 then
    g:fillRect(0, 0, W, headerH, color and 0x18408C or FG)
    g:setTextColor(color and 0xFFFFFF or BG)
    g:setTextSize(1)
    g:setTextDatum(lgfx.MC_DATUM)
    g:drawString("Bench", W // 2, headerH // 2)
  end
  g:setTextDatum(lgfx.TL_DATUM)
  local y = headerH + 4
  if not compact then
    g:setTextColor(FG)
    g:drawString(fit(s.model or "display", 1), 2, y)
    g:setTextColor(color and 0xC6C3C6 or FG)
    g:drawString(fit(W .. "x" .. H .. " " .. (s.controller or ""), 1), 2, y + 10)
    y = y + 20
  end

  -- Colour bars, or 1-bit hatching that gets sparser, along the bottom.
  local barsH = compact and 0 or math.max(8, (H + 4) // 8)
  for i = 0, 7 do
    local x0, x1 = i * W // 8, (i + 1) * W // 8
    if color then
      g:fillRect(x0, H - barsH, x1 - x0, barsH, hsv(i * 45, 1, 1))
    else
      for yy = H - barsH, H - 1 do
        for xx = x0, x1 - 1 do
          if (xx + yy) % (i + 2) == 0 then g:drawPixel(xx, yy, FG) end
        end
      end
    end
  end

  footerY = H - barsH - 10
  top = compact and 0 or y + 2
  bottom = compact and H - 9 or footerY - 2
  local r = math.max(3, math.min(W, bottom - top) // 10)
  ball = { x = W / 2, y = (top + bottom) / 2, vx = W * 0.6, vy = W * 0.45, r = r }
end

local function step(dt)
  local b = ball
  b.x = b.x + b.vx * dt
  b.y = b.y + b.vy * dt
  if b.x - b.r < 0 or b.x + b.r >= W then b.vx = -b.vx end
  if b.y - b.r < top or b.y + b.r >= bottom then b.vy = -b.vy end
  b.x = math.min(W - b.r - 1, math.max(b.r, b.x))
  b.y = math.min(bottom - b.r - 1, math.max(top + b.r, b.y))
end

function init(ctx)
  backdrop()
  g:fillCircle(math.floor(ball.x), math.floor(ball.y), ball.r, color and hsv(hue, 0.8, 1) or FG)
  log.info("Running on " .. (s.model or "a display") .. ": " .. W .. "x" .. H)
  g:flip()
  wait = 0
end

function on_tick(ctx, dt_ms)
  if slow then
    wait = wait + dt_ms
    if wait < 5000 then return end
    dt_ms, wait = wait, 0
  end

  g:fillCircle(math.floor(ball.x), math.floor(ball.y), ball.r, BG)
  -- Small steps, so a long e-paper gap still bounces off the walls.
  local left = dt_ms / 1000
  while left > 0 do
    local dt = math.min(left, 0.05)
    step(dt)
    left = left - dt
  end
  if not slow then hue = (hue + dt_ms * 0.036) % 360 end
  g:fillCircle(math.floor(ball.x), math.floor(ball.y), ball.r, color and hsv(hue, 0.8, 1) or FG)

  -- Footer: uptime and how often on_tick runs.
  local now = ctx.time_ms
  ticks[#ticks + 1] = now
  while #ticks > 0 and now - ticks[1] > 1000 do table.remove(ticks, 1) end
  g:fillRect(0, footerY, W, 9, BG)
  g:setTextSize(1)
  g:setTextDatum(lgfx.TL_DATUM)
  g:setTextColor(color and 0xB4FF2F or FG)
  local up = string.format("%.1fs", now / 1000)
  g:drawString(slow and ("up " .. now // 1000 .. "s") or (up .. "  " .. #ticks .. " fps"), 2, footerY + 1)
  g:flip()
end

function on_event(ctx, e)
  if e.name == "tap" and e.data.index == 0 then
    hue = (hue + 70) % 360
    log.info("A pressed")
  end
end
