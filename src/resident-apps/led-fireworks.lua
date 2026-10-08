-- Fireworks: rockets climb from the bottom of the matrix and burst into sparks that fall and fade. Launch (or A) sends one up; left alone, they go up on their own.
-- @output matrix
local W, H = leds.width(), leds.height()
local launcher = trigger.new("launch", { label = "Launch", key = "Space", via = "button" })
local bright = dial.new("brightness", { min = 4, max = 255, step = 1, start = 90, via = "pot" })

local G = H * 1.1        -- rows per second², so 8 and 16 rows look alike
local r, g, b = {}, {}, {}
for i = 0, W * H - 1 do r[i], g[i], b[i] = 0, 0, 0 end
local rockets, sparks = {}, {}
local wait = 0.2         -- seconds until the next rocket goes up on its own

local function launch()
  local top = H * (0.1 + math.random() * 0.35)        -- the row it bursts at
  rockets[#rockets + 1] = {
    x = math.random(1, math.max(1, W - 2)),
    y = H - 1,
    vy = -math.sqrt(2 * G * (H - 1 - top)),             -- just enough to get there
    hue = math.random(0, 359),
  }
end

local function burst(rk)
  for _ = 1, math.min(28, 10 + W * H // 16) do
    local a = math.random() * 2 * math.pi
    local s = (0.3 + math.random() * 0.7) * H * 0.8
    sparks[#sparks + 1] = { x = rk.x, y = rk.y, vx = math.cos(a) * s, vy = math.sin(a) * s,
      life = 1, hue = rk.hue + math.random(-25, 25) }
  end
end

-- Add colour c, weighted by w, to the pixel nearest (x, y).
local function plot(x, y, c, w)
  local px, py = math.floor(x + 0.5), math.floor(y + 0.5)
  if px < 0 or px >= W or py < 0 or py >= H then return end
  local i = py * W + px
  r[i] = math.min(255, r[i] + ((c >> 16) & 255) * w)
  g[i] = math.min(255, g[i] + ((c >> 8) & 255) * w)
  b[i] = math.min(255, b[i] + (c & 255) * w)
end

leds.on_frame(function(ctx, dt_ms)
  local dt = dt_ms / 1000
  local fade = math.exp(-dt * 7) -- what's drawn fades over a fraction of a second: trails
  for i = 0, W * H - 1 do r[i], g[i], b[i] = r[i] * fade, g[i] * fade, b[i] * fade end

  wait = wait - dt
  if wait <= 0 then
    launch()
    wait = 0.7 + math.random() * 1.5
  end

  local still = {}
  for _, rk in ipairs(rockets) do
    rk.vy = rk.vy + G * dt
    rk.y = rk.y + rk.vy * dt
    if rk.vy >= -G * 0.08 then burst(rk) else
      plot(rk.x, rk.y, 0xffc070, 1)
      still[#still + 1] = rk
    end
  end
  rockets = still

  still = {}
  for _, s in ipairs(sparks) do
    s.vx, s.vy = s.vx * (1 - dt * 1.5), s.vy * (1 - dt * 1.5) + G * 0.4 * dt -- air drag, then gravity
    s.x, s.y = s.x + s.vx * dt, s.y + s.vy * dt
    s.life = s.life - dt / 1.3
    if s.life > 0 and s.y < H then
      plot(s.x, s.y, leds.hsv(s.hue, 0.25 + 0.75 * (1 - s.life), 1), s.life) -- white-hot, then coloured
      still[#still + 1] = s
    end
  end
  sparks = still

  for i = 0, W * H - 1 do leds.set_rgb(i, math.floor(r[i]), math.floor(g[i]), math.floor(b[i])) end
  leds.brightness(bright:value())
  leds.show()
end)

function on_event(ctx, e)
  if e.name == "tap" and e.data.index == 0 then launch() end
  if e.name == "trigger" and e.data.name == "launch" and e.data.pressed then launch() end
end
