-- Bouncing balls: three balls dropped from the far end bounce under gravity, each losing a little height every bounce. A drops them again.
-- @output strip
local bright = dial.new("brightness", { min = 4, max = 255, step = 1, start = 100, via = "pot" })

local n = leds.count()
local G = 2.2                  -- strip lengths per second²: a drop from the top lands in ~0.95 s
local HUES = { 0, 130, 220 }   -- red, green, blue
local KEEP = { 0.86, 0.80, 0.74 } -- share of its speed each ball keeps per bounce, so they drift apart

local balls = {}
local function drop()
  for k = 1, #HUES do
    balls[k] = { h = 1 - (k - 1) * 0.08, v = 0 } -- height 0..1 along the chain, from LED 0
  end
end
drop()

-- Off-white grows into each ball's colour, so a ball sitting on the floor reads as a dot of colour.
local r, g, b = {}, {}, {}

leds.on_frame(function(ctx, dt_ms)
  local dt = dt_ms / 1000
  for i = 0, n - 1 do r[i], g[i], b[i] = 0, 0, 0 end

  for k, ball in ipairs(balls) do
    ball.v = ball.v - G * dt
    ball.h = ball.h + ball.v * dt
    if ball.h <= 0 then
      ball.h = 0
      ball.v = -ball.v * KEEP[k]
      if ball.v < 0.25 then ball.v = math.sqrt(2 * G * (0.85 + math.random() * 0.15)) end -- tired: a fresh throw
    end
    -- Spread the ball over the two LEDs either side of its exact position, so it glides.
    local p = ball.h * (n - 1)
    local i0 = math.floor(p)
    local f = p - i0
    local c = leds.hsv(HUES[k], 1, 1)
    local cr, cg, cb = (c >> 16) & 255, (c >> 8) & 255, c & 255
    for _, side in ipairs({ { i0, 1 - f }, { i0 + 1, f } }) do
      local i, w = side[1], side[2]
      if i >= 0 and i < n then
        r[i], g[i], b[i] = r[i] + cr * w, g[i] + cg * w, b[i] + cb * w
      end
    end
  end

  for i = 0, n - 1 do
    leds.set_rgb(i, math.floor(math.min(255, r[i])), math.floor(math.min(255, g[i])), math.floor(math.min(255, b[i])))
  end
  leds.brightness(bright:value())
  leds.show()
end)

function on_event(ctx, e)
  if e.name == "tap" and e.data.index == 0 then drop() end
end
