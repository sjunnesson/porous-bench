-- Level meter: a VU-style bar, green to yellow to red, with a falling peak LED. It shows the Level dial, which you can drive from any sensor in Connections: light, temperature, radar distance or a pot.
-- @output strip
local level = dial.new("level", { min = 0, max = 100, start = 40, via = "light" })

local n = leds.count()
local HOLD_MS = 900      -- the peak waits this long before it falls
local FALL = 0.35        -- then falls this much of the bar per second
local shown, peak, held = 0, 0, 0

-- Green along most of the bar, yellow near the top, red at the end.
local hues = {}
for i = 0, n - 1 do
  local f = n > 1 and i / (n - 1) or 0
  hues[i] = 120 * math.max(0, math.min(1, (0.95 - f) / 0.4))
end

leds.on_frame(function(ctx, dt_ms)
  local target = level:fraction()
  -- A meter's ballistics: quick to rise, slower to fall.
  local tau = target > shown and 60 or 300
  shown = shown + (target - shown) * (1 - math.exp(-dt_ms / tau))

  if shown >= peak then
    peak, held = shown, 0
  else
    held = held + dt_ms
    if held > HOLD_MS then peak = math.max(shown, peak - FALL * dt_ms / 1000) end
  end

  local fill = shown * n
  local top = math.max(0, math.min(n - 1, math.floor(peak * n - 0.001)))
  for i = 0, n - 1 do
    local lit = math.max(0, math.min(1, fill - i))
    local v = 0.05 + 0.95 * lit -- unlit LEDs glow faintly, so you can see the scale
    leds.set(i, leds.hsv(hues[i], 1, v))
  end
  if peak > 0.01 and peak * n > fill + 0.5 then leds.set(top, leds.hsv(hues[top], 0.35, 1)) end
  leds.brightness(100)
  leds.show()
end)

function on_tick(ctx) end
