-- Pong: one-dimensional pong for two. Tap A when the ball reaches the start of the LEDs, B at the far end, to hit it back; it speeds up every hit. Five points wins. Left alone, it plays itself.
-- @output strip
local bright = dial.new("brightness", { min = 4, max = 255, step = 1, start = 100, via = "pot" })

local n = leds.count()
local ZONE = math.max(2, math.floor(n / 8)) -- each end's hitting zone, in LEDs
local SERVE = math.max(4, n / 3)           -- ball speed on a serve, LEDs per second
local COL = { 0x0060ff, 0xff7000 }          -- A blue, B orange
local WIN = 5

local pos, vel = ZONE, SERVE  -- ball position in LEDs from LED 0, velocity (+ is towards B)
local score = { 0, 0 }
local pause = 0               -- seconds left showing a point (or a win) before the next serve
local missed = nil            -- who missed it: 1 = A, 2 = B
local idle = 99               -- seconds since anyone pressed: after a while, it plays itself

local function inZone(player)
  if player == 1 then return vel < 0 and pos < ZONE end
  return vel > 0 and pos > n - 1 - ZONE
end

local function hit(player)
  if pause <= 0 and inZone(player) then vel = -vel * 1.12 end
end

local function point(loser)
  missed = loser
  score[3 - loser] = score[3 - loser] + 1
  pause = score[3 - loser] >= WIN and 3 or 1.4
end

local function serve()
  if score[1] >= WIN or score[2] >= WIN then score = { 0, 0 } end
  -- The winner of the point serves, towards the one who missed.
  if missed == 1 then pos, vel = n - 1 - ZONE, -SERVE else pos, vel = ZONE, SERVE end
  missed = nil
end

-- This frame's colours, added up and sent once at the end.
local r, g, b = {}, {}, {}
local function blend(i, c, w)
  r[i] = r[i] + ((c >> 16) & 255) * w
  g[i] = g[i] + ((c >> 8) & 255) * w
  b[i] = b[i] + (c & 255) * w
end

leds.on_frame(function(ctx, dt_ms)
  local dt = dt_ms / 1000
  idle = idle + dt
  for i = 0, n - 1 do r[i], g[i], b[i] = 0, 0, 0 end

  if pause > 0 then
    pause = pause - dt
    -- The score from each end in its player's colour, the side that missed flashing red.
    for p = 1, 2 do
      for k = 0, score[p] - 1 do blend(p == 1 and k or n - 1 - k, COL[p], 0.6) end
    end
    if missed and math.floor(pause * 4) % 2 == 0 then
      for k = 0, ZONE - 1 do blend(missed == 1 and k or n - 1 - k, 0xff0000, 0.5) end
    end
    if pause <= 0 then serve() end
  else
    pos = pos + vel * dt
    if idle > 8 then -- nobody's playing: return the ball most of the time
      for p = 1, 2 do
        if inZone(p) and math.abs(pos - (p == 1 and 1 or n - 2)) < 0.6 and math.random() < 0.97 then hit(p) end
      end
    end
    if pos < 0 then point(1) elseif pos > n - 1 then point(2) end
    for k = 0, ZONE - 1 do
      blend(k, COL[1], 0.12)
      blend(n - 1 - k, COL[2], 0.12)
    end
    local i0 = math.floor(pos)
    local f = pos - i0
    if i0 >= 0 and i0 < n then blend(i0, 0xffffff, 1 - f) end
    if i0 + 1 >= 0 and i0 + 1 < n then blend(i0 + 1, 0xffffff, f) end
  end

  for i = 0, n - 1 do
    leds.set_rgb(i, math.floor(math.min(255, r[i])), math.floor(math.min(255, g[i])), math.floor(math.min(255, b[i])))
  end
  leds.brightness(bright:value())
  leds.show()
end)

function on_event(ctx, e)
  if e.name == "tap" then
    idle = 0
    hit(e.data.index == 0 and 1 or 2)
  end
end
