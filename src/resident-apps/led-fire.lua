-- Fire: the classic Fire2012 flame. Cooling and Sparking are dials.
-- @output strip
local cooling = dial.new("cooling", { min = 20, max = 100, start = 55, via = "pot" })
local sparking = dial.new("sparking", { min = 50, max = 200, step = 5, start = 120, via = "encoder" })

local n = leds.count()
-- Fire2012 is tuned for ~30-60 cells: a longer strip runs it on fewer cells and blends between
-- them, so the flames stay in proportion instead of hugging the base.
local m = math.min(n, 48)
local SPARK_ZONE = math.max(1, math.min(7, m // 5))
local heat = {}
for k = 0, m - 1 do heat[k] = 0 end

local random, floor, min, max = math.random, math.floor, math.min, math.max

-- FastLED's HeatColor: black -> red -> orange -> yellow -> white.
local function heat_colour(h)
  local t = h * 3 / 255
  local r, g, b
  if t < 1 then r, g, b = t, 0, 0
  elseif t < 2 then r, g, b = 1, t - 1, 0
  else r, g, b = 1, 1, (t - 2) * 0.8 end
  return (floor(r * 255) << 16) | (floor(g * 255) << 8) | floor(b * 255)
end

local function step()
  -- 1. Every cell cools a little.
  local cool = floor(cooling:value() * 10 / m) + 2
  for k = 0, m - 1 do heat[k] = max(0, heat[k] - random(0, cool)) end
  -- 2. Heat drifts up and diffuses.
  for k = m - 1, 2, -1 do heat[k] = (heat[k - 1] + 2 * heat[k - 2]) / 3 end
  if m > 1 then heat[1] = (heat[1] + heat[0]) / 2 end
  -- 3. Now and then a new spark near the base.
  if random(0, 255) < sparking:value() then
    local y = random(0, SPARK_ZONE - 1)
    heat[y] = min(255, heat[y] + random(160, 255))
  end
end

leds.on_frame(function(ctx, dt_ms)
  step()
  for i = 0, n - 1 do
    local h
    if m == n then h = heat[i]
    else
      local x = i * (m - 1) / (n - 1)
      local k = floor(x)
      local f = x - k
      h = heat[k] * (1 - f) + heat[min(m - 1, k + 1)] * f
    end
    leds.set(i, heat_colour(min(255, h)))
  end
  leds.brightness(110)
  leds.show()
end)

function on_tick(ctx) end
