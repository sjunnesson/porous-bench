-- LD2410 radar: a presence dashboard fed by a simulated HLK-LD2410 over UART. Drag the character in the radar, or let it wander.
local g = lgfx.bind("main")
local s = screens.get("main")
local W, H = g:width(), g:height()
local color = s.depth == 16
local paper = s.scheme == "light" -- e-paper: redraw on a state change or every 10 s
local BG = paper and 0xFFFFFF or 0x000000
local FG = paper and 0x000000 or 0xFFFFFF
local GREY = 0x7B7D7B
local MAX_CM = 600

ld2410.begin({ mode = "wander" })

local history = {}
local lastDraw, lastState = -1e9, -1

local function stateOf(r) return (r.moving and 1 or 0) | (r.still and 2 or 0) end

local function badge(r)
  if r.moving then return "MOVING", 0xFFA500 end
  if r.still then return "PRESENT", 0x00FF00 end
  return "EMPTY", GREY
end

local function bar(x, y, w, h, value, c)
  g:drawRect(x, y, w, h, color and GREY or FG)
  g:fillRect(x + 1, y + 1, math.floor((w - 2) * value / 100 + 0.5), h - 2, color and c or FG)
end

local function metres(cm) return string.format("%.2f m", cm / 100) end

local function draw(r, state)
  local label, stateColor = badge(r)
  g:fillScreen(BG)
  g:setTextDatum(lgfx.TL_DATUM)

  if H < 48 then
    -- Tiny OLED: one line of state, one of distance.
    g:setTextColor(FG)
    g:setTextSize(2)
    g:drawString(label, 0, 0)
    g:setTextSize(1)
    g:drawString(state ~= 0 and metres(r.distance_cm) or "--", 0, 20)
    g:setTextDatum(lgfx.TR_DATUM)
    g:drawString(r.connected and "UART ok" or "no data", W - 1, 20)
    g:flip()
    return
  end

  -- Header.
  g:setTextSize(1)
  g:setTextColor(color and 0xC6C3C6 or FG)
  g:drawString("LD2410", 2, 2)
  g:setTextDatum(lgfx.TR_DATUM)
  g:drawString(r.connected and "UART ok" or "no data", W - 2, 2)

  -- State badge.
  local big = W >= 160 and 3 or 2
  local by, bh = 14, 8 * big + 8
  if color then g:fillRoundRect(2, by, W - 4, bh, 6, stateColor)
  elseif state ~= 0 then g:fillRoundRect(2, by, W - 4, bh, 4, FG)
  else g:drawRoundRect(2, by, W - 4, bh, 4, FG) end
  g:setTextSize(big)
  g:setTextColor(color and 0x000000 or (state ~= 0 and BG or FG))
  g:setTextDatum(lgfx.MC_DATUM)
  g:drawString(label, W // 2, by + bh // 2)

  -- Distance, and a 0..6 m scale with a marker.
  local y = by + bh + 8
  local size = H >= 200 and 2 or 1
  g:setTextSize(size)
  g:setTextColor(FG)
  g:setTextDatum(lgfx.TC_DATUM)
  g:drawString(state ~= 0 and metres(r.distance_cm) or "-- m", W // 2, y)
  y = y + 8 * size + 4
  g:setTextSize(1)
  local gx, gw = 6, W - 12
  g:drawLine(gx, y + 6, gx + gw, y + 6, color and GREY or FG)
  for m = 0, 6 do
    local tx = gx + gw * m // 6
    g:drawLine(tx, y + 3, tx, y + 9, color and GREY or FG)
  end
  if state ~= 0 then
    local mx = gx + gw * math.min(r.distance_cm, MAX_CM) // MAX_CM
    g:fillTriangle(mx - 4, y - 2, mx + 4, y - 2, mx, y + 5, color and stateColor or FG)
  end
  y = y + 14

  -- Energies.
  g:setTextDatum(lgfx.TL_DATUM)
  if H >= 100 then
    g:setTextColor(color and 0xC6C3C6 or FG)
    g:drawString("move " .. r.moving_energy, 2, y)
    bar(2, y + 10, W - 4, 8, r.moving_energy, 0xFFA500)
    y = y + 22
    g:drawString("still " .. r.still_energy, 2, y)
    bar(2, y + 10, W - 4, 8, r.still_energy, 0x00FF00)
    y = y + 24
  end

  -- Distance history, newest on the right.
  local top, bottom = y, H - 3
  if bottom - top > 16 then
    g:drawRect(0, top, W, bottom - top + 1, color and 0x282830 or FG)
    local n = #history
    for i = 1, n do
      local v = history[i]
      if v >= 0 then
        local px = W - n + i - 1
        local py = bottom - 1 - (bottom - top - 2) * math.min(v, MAX_CM) // MAX_CM
        g:drawPixel(px, py, color and 0x00FFFF or FG)
      end
    end
  end
  g:flip()
end

function on_tick(ctx, dt_ms)
  local r = ld2410.read()
  local state = stateOf(r)
  local now = ctx.time_ms
  if paper and state == lastState and now - lastDraw < 10000 then return end
  lastDraw, lastState = now, state
  history[#history + 1] = state ~= 0 and r.distance_cm or -1
  if #history > W then table.remove(history, 1) end
  draw(r, state)
end

function on_event(ctx, e)
  if e.name == "presence" then
    log.info(string.format("presence: moving %s, still %s at %d cm", tostring(e.data.moving), tostring(e.data.still), e.data.distance_cm))
  end
end
