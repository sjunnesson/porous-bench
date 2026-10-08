-- Digital rain: glowing drops of code falling down the matrix, each column at its own pace. Speed sets how fast; A switches between green, blue and amber.
-- @output matrix
local W, H = leds.width(), leds.height()
local speed = dial.new("speed", { min = 1, max = 20, start = 8 })
local bright = dial.new("brightness", { min = 4, max = 255, step = 1, start = 80, via = "pot" })

local HUES = { 120, 195, 35 } -- green, blue, amber
local pick = 1

-- One drop per column: its head's row (rising past the bottom), pace and tail length.
local drops = {}
local function fresh(x, start)
  drops[x] = {
    -- At the start, anywhere from well above the top to most of the way down, so it's raining at
    -- once; after that, a new drop starts just above the top.
    y = start and math.random() * H * 1.6 - H * 0.8 or -math.random() * H / 2 - 1,
    pace = 0.6 + math.random() * 0.8,
    len = math.random(3, math.max(4, H)),
  }
end
for x = 0, W - 1 do fresh(x, true) end

leds.on_frame(function(ctx, dt_ms)
  local rows = speed:value() * H / 16 * dt_ms / 1000 -- the same look on 8 and 16 rows
  local hue = HUES[pick]
  for x = 0, W - 1 do
    local d = drops[x]
    d.y = d.y + rows * d.pace
    if d.y - d.len > H then fresh(x, false) end
    for y = 0, H - 1 do
      local behind = d.y - y
      local c = 0
      if behind >= 0 and behind < 1 then
        c = leds.hsv(hue, 0.3, 1)                     -- the head, nearly white
      elseif behind >= 1 and behind < d.len then
        local v = 1 - behind / d.len
        c = leds.hsv(hue, 1, v * v)                   -- the tail, fading out
      end
      leds.set(leds.xy(x, y), c)
    end
  end
  leds.brightness(bright:value())
  leds.show()
end)

function on_event(ctx, e)
  if e.name == "tap" and e.data.index == 0 then pick = pick % #HUES + 1 end
end
