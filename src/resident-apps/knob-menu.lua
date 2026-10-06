-- Knob menu: a settings menu. Turn to move, push to edit, B to back out; a second dial drives the gauge and Brightness sets the real backlight.
local g = lgfx.bind("main")
local s = screens.get("main")
local W, H = g:width(), g:height()
local color = s.depth == 16

-- The hardware this app wants on the desk. Each can be swapped in Controls without touching code.
local move = dial.new("move") -- open range: only its steps matter
local select = trigger.new("select", { key = "Enter", via = "encoder-push" })
local gauge = dial.new("gauge", { min = 0, max = 4095, step = 1, start = 1640, via = "pot",
  keys = { down = "BracketLeft", up = "BracketRight" } })

local settings = { brightness = 80, hue = 200, animate = true, invert = false }
local cursor, editing, phase = 1, false, 0
local paper = s.scheme == "light" -- e-paper: every flip is a refresh, so only redraw on a change
local canDim = not paper
local lastGauge = nil

local function clamp(v, lo, hi) return math.max(lo, math.min(hi, v)) end

local items = {
  { label = "Brightness", value = function() return settings.brightness .. "%" end,
    adjust = function(c) settings.brightness = clamp(settings.brightness + c * 5, 5, 100) end },
  { label = "Accent", value = function() return settings.hue .. "deg" end,
    adjust = function(c) settings.hue = (settings.hue + c * 10) % 360 end },
  { label = "Animate", value = function() return settings.animate and "on" or "off" end,
    adjust = function() settings.animate = not settings.animate end },
  { label = "Invert", value = function() return settings.invert and "on" or "off" end,
    adjust = function() settings.invert = not settings.invert end },
  { label = "Gauge", value = function() return tostring(gauge:value()) end },
}

local function hsv(h, sat, v)
  h = h % 360
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

local function draw()
  local lightBg = settings.invert ~= paper -- e-paper is light by nature; Invert flips either way
  local bg = lightBg and 0xFFFFFF or 0x000000
  local fg = lightBg and 0x000000 or 0xFFFFFF
  local accent = color and hsv(settings.hue, 0.75, 1) or fg
  g:fillScreen(bg)

  local big = H >= 200 and W >= 160 -- size-2 text needs ~170 px for "Brightness 100%"
  local rowH = big and 22 or (H >= 64 and 12 or 8)
  local size = big and 2 or 1
  local titleH = H >= 64 and rowH or 0
  g:setTextSize(size)
  if titleH > 0 then
    g:fillRect(0, 0, W, titleH - 2, accent)
    g:setTextColor(color and 0x000000 or bg)
    g:setTextDatum(lgfx.MC_DATUM)
    g:drawString(editing and "EDIT" or "MENU", W // 2, (titleH - 2) // 2)
  end

  local visible = (H - titleH - (H >= 120 and 50 or 0)) // rowH
  local first = clamp(cursor - visible, 0, math.max(0, #items - visible))
  for i = first + 1, math.min(#items, first + visible) do
    local y = titleH + (i - first - 1) * rowH
    local selected = i == cursor
    if selected then
      if editing then g:drawRoundRect(0, y, W, rowH - 1, 3, accent)
      else g:fillRoundRect(0, y, W, rowH - 1, 3, accent) end
    end
    g:setTextColor(selected and not editing and (color and 0x000000 or bg) or fg)
    local ty = y + (rowH - 1) // 2
    g:setTextDatum(lgfx.ML_DATUM)
    g:drawString(items[i].label, 4, ty)
    g:setTextDatum(lgfx.MR_DATUM)
    g:drawString(items[i].value(), W - 4, ty)
  end

  -- The gauge, driven by the second dial, with an optional orbiting dot.
  if H >= 120 then
    local cx, cy = W // 2, H - 8
    local r = math.min(W // 2 - 8, 42)
    for a = 0, 180, 6 do
      local rad = math.pi * (180 + a) / 180
      g:drawPixel(cx + math.floor(math.cos(rad) * r), cy + math.floor(math.sin(rad) * r), color and 0x7B7D7B or fg)
    end
    local rad = math.pi * (1 + gauge:fraction())
    g:drawLine(cx, cy, cx + math.floor(math.cos(rad) * (r - 4)), cy + math.floor(math.sin(rad) * (r - 4)), accent)
    g:fillCircle(cx, cy, 3, accent)
    if settings.animate then
      local px = cx + math.floor(math.cos(phase) * (r + 4))
      local py = cy - math.floor(math.abs(math.sin(phase)) * (r + 4))
      g:fillCircle(px, py, 2, color and hsv(settings.hue + 120, 0.7, 1) or fg)
    end
  end
  g:flip()
end

function init(ctx)
  draw()
end

function on_tick(ctx, dt_ms)
  local clicks = move:delta()
  local changed = gauge:value() ~= lastGauge
  lastGauge = gauge:value()
  if select:was_pressed() and items[cursor].adjust then
    editing = not editing
    changed = true
  end
  if clicks ~= 0 then
    changed = true
    if editing then items[cursor].adjust(clicks)
    else cursor = clamp(cursor + clicks, 1, #items) end
  end
  phase = phase + dt_ms * 0.005
  if canDim then screens.set("main", { brightness = settings.brightness / 100 }) end
  if not paper or changed then draw() end
end

function on_event(ctx, e)
  if e.name == "tap" and e.data.index == 1 and editing then
    editing = false
    draw()
  end
end
