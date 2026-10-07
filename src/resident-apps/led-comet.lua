-- Comet: a comet with a fading tail running along the LEDs. A changes its colour.
-- @output strip
local speed = dial.new("speed", { min = 1, max = 20, start = 6 })
local bright = dial.new("brightness", { min = 4, max = 255, step = 1, start = 100, via = "pot" })
local nextc = trigger.new("next", { label = "Next colour", key = "KeyC", via = "button" })

local n = leds.count()
local TAIL = math.max(3, n * 0.3)          -- the tail is about a third of the chain
local RATE = n / 16 + 1                    -- LEDs/s per speed step: long strips need a quicker comet
local HUES = { 200, 25, 300, 120, 0, 50, 260 } -- ice blue, amber, magenta, green, red, gold, violet

local pick = 1
local hue = HUES[pick]                     -- eased toward HUES[pick], so a change sweeps through
local pos = 0

local function next_colour()
  pick = pick % #HUES + 1
end

leds.on_frame(function(ctx, dt_ms)
  pos = (pos + speed:value() * RATE * dt_ms / 1000) % n

  -- Ease the hue the short way round the colour wheel.
  local diff = (HUES[pick] - hue + 540) % 360 - 180
  hue = (hue + diff * math.min(1, dt_ms / 150)) % 360

  for i = 0, n - 1 do
    local behind = (pos - i) % n            -- LEDs behind the head, wrapping round
    local v, sat = 0, 1
    if behind <= TAIL then
      local t = behind / TAIL
      v = (1 - t) * (1 - t)                 -- quadratic fade looks natural on WS2812s
      sat = 0.25 + 0.75 * math.min(1, t * 3) -- a white-hot head, colour in the tail
    elseif n - behind < 1 then
      v, sat = 1 - (n - behind), 0.25        -- the LED just ahead catches the head's leading edge
    end
    leds.set(i, leds.hsv(hue + behind * 4, sat, v))
  end
  leds.brightness(bright:value())
  leds.show()
end)

function on_event(ctx, e)
  if e.name == "tap" and e.data.index == 0 then next_colour() end
  if e.name == "trigger" and e.data.name == "next" and e.data.pressed then next_colour() end
end
