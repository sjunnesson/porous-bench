-- From inanimate-tech/resident examples/m5stick-demo/device-apps/rainbow.lua (MIT)
-- Rainbow: animated color cycling across the display
-- @needs motion color
-- Every pixel changes, and flipping them all takes a big panel 30 ms alone, so a screen of more than
-- PIXELS paints every other 16 px band a tick, as many ticks apart as it takes: a flip pushes only those.
local PIXELS = 100000
local W, H = screen.width(), screen.height()
local BAND = W > 300 and 16 or 4
local COLS = W // BAND + 1
local TURNS = math.max(1, W * H // PIXELS + (W * H % PIXELS > 0 and 1 or 0))

-- One turn of the hue in 256 steps, worked out once: a sine per channel per column is most of a tick.
local RED, GREEN, BLUE = {}, {}, {}
for i = 0, 255 do
  local a = i / 256 * 6.2832
  RED[i] = math.floor((math.sin(a) * 0.5 + 0.5) * 255)
  GREEN[i] = math.floor((math.sin(a + 2.094) * 0.5 + 0.5) * 255)
  BLUE[i] = math.floor((math.sin(a + 4.189) * 0.5 + 0.5) * 255)
end

local turn = 0
function on_tick(ctx, dt_ms)
  local t = ctx.time_ms * 77 // 1000 -- 0.3 turns a second, in 256ths of a turn
  turn = turn % TURNS + 1
  for c = turn - 1, COLS - 1, TURNS do
    local i = (c * BAND * 256 // W + t) & 255
    screen.fill_rect(c * BAND, 0, BAND, H, RED[i], GREEN[i], BLUE[i])
  end
  screen.flip()
end
