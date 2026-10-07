-- Rainbow chase: a rainbow running along the LEDs. Speed and Brightness can be any hardware (Connections).
-- @output strip
local speed = dial.new("speed", { min = 1, max = 20, start = 6 })
local bright = dial.new("brightness", { min = 4, max = 255, step = 1, start = 96, via = "pot",
  keys = { down = "Minus", up = "Equal" } })

local n = leds.count()
local phase = 0

-- The LED driver's frame timer: 50 times a second, smooth between 10 Hz ticks.
leds.on_frame(function(ctx, dt_ms)
  phase = (phase + speed:value() * dt_ms * 0.04) % 360
  for i = 0, n - 1 do
    leds.set(i, leds.hsv(phase + i * 360 / n, 1, 1))
  end
  leds.brightness(bright:value())
  leds.show()
end)

function on_tick(ctx) end
