-- Plasma: a smooth, colourful sum-of-sines plasma flowing across the matrix. Speed and Brightness are dials; A changes the palette.
-- @output matrix
local W, H = leds.width(), leds.height()
local speed = dial.new("speed", { min = 1, max = 20, start = 5 })
local bright = dial.new("brightness", { min = 4, max = 255, step = 1, start = 80, via = "pot",
  keys = { down = "Minus", up = "Equal" } })

local sin, sqrt = math.sin, math.sqrt
-- Same features on every size: an 8-pixel side spans the pattern a 16-pixel side does at finer grain.
local S = 8 / math.min(W, H)
local CX, CY = (W - 1) / 2 * S, (H - 1) / 2 * S

-- Palettes map the plasma's 0..1 value to a colour.
local PALETTES = {
  function(v, t) return leds.hsv(v * 360 + t * 12, 1, 1) end,                              -- rainbow
  function(v) return leds.hsv(v * 60, 1, math.min(1, 0.15 + v * 1.1)) end,                  -- fire
  function(v) return leds.hsv(170 + v * 80, 1 - v * 0.5, 0.25 + v * 0.75) end,              -- ocean
  function(v, t) return leds.hsv(280 + v * 100 + sin(t * 0.3) * 30, 0.9, 0.3 + v * 0.7) end, -- dusk
}
local palette = 1
local t = 0

leds.on_frame(function(ctx, dt_ms)
  t = t + speed:value() * dt_ms / 1000 * 0.35
  local pal = PALETTES[palette]
  -- A slowly orbiting centre for the radial ripple.
  local ox = CX + sin(t * 0.7) * 3
  local oy = CY + sin(t * 0.9 + 1) * 3
  for y = 0, H - 1 do
    local v_ = y * S
    for x = 0, W - 1 do
      local u = x * S
      local dx, dy = u - ox, v_ - oy
      local s = sin(u * 0.55 + t)
        + sin(v_ * 0.45 - t * 1.3)
        + sin((u + v_) * 0.35 + t * 0.7)
        + sin(sqrt(dx * dx + dy * dy) * 0.8 - t * 1.6)
      leds.set(leds.xy(x, y), pal(math.max(0, math.min(1, 0.5 + s / 5)), t))
    end
  end
  leds.brightness(bright:value())
  leds.show()
end)

function on_event(ctx, e)
  if e.name == "tap" and e.data.index == 0 then palette = palette % #PALETTES + 1 end
end
