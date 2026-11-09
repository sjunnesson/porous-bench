-- Knob modes: the SmartKnob's own demo of what its motor can make a knob feel like. Press the knob for the next: free, with ends, an on/off switch, a spring to the middle, fine and coarse detents, magnets; hold it for the one before. The LEDs follow the pointer.
-- @output display
local g = lgfx.bind("main")
local s = screens.get("main")
local W, H = g:width(), g:height()
local CX, CY = W // 2, H // 2
local R = math.min(W, H) // 2
local floor, sin, cos, rad = math.floor, math.sin, math.cos, math.rad

-- The SmartKnob firmware's demo configs (interface_task.cpp), widths in degrees, its LED hues in degrees.
local MODES = {
  { text = "Unbounded", sub = "no detents", min = 0, max = -1, width = 10, detent = 0, hue = 282 },
  { text = "Bounded 0-10", sub = "no detents", min = 0, max = 10, width = 10, detent = 0, hue = 0 },
  { text = "Multi-rev", sub = "0-72, no detents", min = 0, max = 72, width = 10, detent = 0, hue = 103 },
  { text = "On / off", sub = "strong detent", min = 0, max = 1, width = 60, detent = 1, snap = 0.55, hue = 222, names = { [0] = "off", [1] = "on" } },
  { text = "Return", sub = "to centre", min = 0, max = 0, width = 60, detent = 0.01, endstop = 0.6, hue = 64 },
  { text = "Fine values", sub = "no detents", min = 0, max = 255, width = 1, detent = 0, position = 127, hue = 309 },
  { text = "Fine values", sub = "with detents", min = 0, max = 255, width = 1, detent = 1, position = 127, hue = 35 },
  { text = "Coarse values", sub = "weak detents", min = 0, max = 31, width = 8.2258, detent = 0.2, hue = 0 },
  { text = "Magnetic", sub = "detents at 2 10 21 22", min = 0, max = 31, width = 7, detent = 2.5, snap = 0.7, magnets = { 2, 10, 21, 22 }, hue = 103 },
  { text = "Return", sub = "with detents", min = -6, max = 6, width = 60, detent = 1, snap = 0.55, bias = 0.4, hue = 222 },
}
local mode = 1

local function apply()
  local m = MODES[mode]
  -- A nonce of its own, so coming back to a mode sets its position again.
  haptic.config({ min = m.min, max = m.max, width = m.width, detent = m.detent, endstop = m.endstop or 1,
    snap = m.snap or 1.1, bias = m.bias or 0, magnets = m.magnets or {}, position = m.position or 0,
    nonce = mode, text = m.text })
end

-- On the rim, at `a` degrees clockwise from the top.
local function rim(a, r)
  return floor(CX + sin(rad(a)) * r + 0.5), floor(CY - cos(rad(a)) * r + 0.5)
end

local last = ""
local function draw()
  local k = haptic.read()
  local m = MODES[mode]
  local key = table.concat({ mode, k.position, floor(k.angle * 2), tostring(k.pressed) }, " ")
  if key == last then return end
  last = key
  local colour = leds.hsv(m.hue, 0.8, 1)
  g:fillScreen(0x000000)
  -- Where each position sits round the rim, from where the knob is turned now.
  local function at(p) return k.angle - k.sub * k.width + (p - k.position) * k.width end
  if k.min <= k.max then
    for _, p in ipairs({ k.min, k.max }) do
      local a = at(p) - k.angle
      if a > -180 and a < 180 then
        local x1, y1 = rim(at(p), R - 4)
        local x2, y2 = rim(at(p), R - 16)
        g:drawLine(x1, y1, x2, y2, 0x888888)
      end
    end
  end
  for _, p in ipairs(k.magnets) do
    local x, y = rim(at(p), R - 9)
    g:fillCircle(x, y, 3, 0x666666)
  end
  local x, y = rim(k.angle, R - 10)
  g:fillCircle(x, y, k.pressed and 7 or 5, colour)

  g:setTextDatum(lgfx.MC_DATUM)
  g:setTextColor(0xFFFFFF)
  g:setTextSize(5)
  g:drawString(m.names and m.names[k.position] or tostring(k.position), CX, CY - 10)
  g:setTextSize(2)
  g:setTextColor(colour)
  g:drawString(m.text, CX, CY + 32)
  g:setTextSize(1)
  g:setTextColor(0xAAAAAA)
  g:drawString(m.sub, CX, CY + 52)
  g:drawString(mode .. " / " .. #MODES, CX, CY - 58)
  g:flip()

  -- The LEDs: the mode's colour, brightest where the knob points (none on a board mirroring this one).
  local n = leds.count()
  if n > 0 then
    local near = floor((k.angle % 360) / 360 * n + 0.5) % n
    for i = 0, n - 1 do leds.set(i, leds.hsv(m.hue, 0.8, (i == near or k.pressed) and 1 or 0.12)) end
    leds.show()
  end
end

function init(ctx)
  apply()
  -- Between ticks too, so the pointer keeps up with the knob.
  leds.on_frame(function() draw() end, 30)
  draw()
end

function on_tick(ctx, dt) draw() end

function on_event(ctx, e)
  if e.name == "tap" and e.data.index == 0 then
    mode = mode % #MODES + 1
    apply()
    haptic.click()
  elseif e.name == "hold" and e.data.held and e.data.index == 0 then
    mode = (mode - 2) % #MODES + 1
    apply()
  end
end
