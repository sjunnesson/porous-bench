-- Twinkle: stars that glint up and fade away at random. Density sets how many; A swaps warm white for colours.
-- @output strip
local density = dial.new("density", { min = 1, max = 20, start = 6 })
local bright = dial.new("brightness", { min = 4, max = 255, step = 1, start = 90, via = "pot" })

local n = leds.count()
local age, hue = {}, {}        -- each star's age (0..1, nil when dark) and colour
local colour = false
local LIFE = 0.9               -- seconds from first glint to dark

leds.on_frame(function(ctx, dt_ms)
  -- On average `density` new stars a second for every 30 LEDs, whatever the chain's length.
  local births = density:value() * n / 30 * dt_ms / 1000
  while births > 0 do
    if math.random() < births then
      local i = math.random(0, n - 1)
      if not age[i] then age[i], hue[i] = 0, math.random(0, 359) end
    end
    births = births - 1
  end

  for i = 0, n - 1 do
    local a = age[i]
    local v = 0
    if a then
      v = math.sin(a * math.pi) ^ 3     -- a quick rise, a long sparkle, a soft end
      a = a + dt_ms / 1000 / LIFE
      age[i] = a < 1 and a or nil
    end
    leds.set(i, colour and leds.hsv(hue[i] or 0, 0.7, v) or leds.hsv(40, 0.25, v))
  end
  leds.brightness(bright:value())
  leds.show()
end)

function on_event(ctx, e)
  if e.name == "tap" and e.data.index == 0 then colour = not colour end
end
