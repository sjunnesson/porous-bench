-- Ripple: drops land at random and send rings of colour spreading both ways, fading as they go. A (or Drop) lets one fall where you choose by the Position dial.
-- @output strip
local where = dial.new("position", { min = 0, max = 100, start = 50, via = "encoder" })
local dropT = trigger.new("drop", { label = "Drop", key = "Space", via = "button" })
local bright = dial.new("brightness", { min = 4, max = 255, step = 1, start = 110, via = "pot" })

local n = leds.count()
local SPEED = math.max(6, n / 2)   -- LEDs per second the ring spreads
local WIDTH = math.max(1.2, n / 25) -- how thick a ripple's crest is, in LEDs
local ripples = {}                  -- { at, r, hue, amp }
local quiet = 0                     -- seconds since the last drop

local function drop(at)
  ripples[#ripples + 1] = { at = at, r = 0, hue = math.random(0, 359), amp = 1 }
  quiet = 0
end
drop(n / 2)

-- Distance along the chain; a ring wraps, and a long strip barely notices.
local function dist(a, b)
  local d = math.abs(a - b) % n
  return math.min(d, n - d)
end

local r, g, b = {}, {}, {}

leds.on_frame(function(ctx, dt_ms)
  local dt = dt_ms / 1000
  quiet = quiet + dt
  if quiet > 1.6 and math.random() < dt * 0.8 then drop(math.random(0, n - 1)) end

  for i = 0, n - 1 do r[i], g[i], b[i] = 0, 0, 0 end
  local keep = {}
  for _, rp in ipairs(ripples) do
    rp.r = rp.r + SPEED * dt
    rp.amp = rp.amp * math.exp(-dt * 1.4)
    if rp.amp > 0.02 and rp.r < n then
      keep[#keep + 1] = rp
      local c = leds.hsv(rp.hue, 0.85, 1)
      local cr, cg, cb = (c >> 16) & 255, (c >> 8) & 255, c & 255
      for i = 0, n - 1 do
        local off = (dist(i, rp.at) - rp.r) / WIDTH
        local w = rp.amp * math.exp(-off * off)
        if w > 0.01 then r[i], g[i], b[i] = r[i] + cr * w, g[i] + cg * w, b[i] + cb * w end
      end
    end
  end
  ripples = keep

  for i = 0, n - 1 do
    leds.set_rgb(i, math.floor(math.min(255, r[i])), math.floor(math.min(255, g[i])), math.floor(math.min(255, b[i])))
  end
  leds.brightness(bright:value())
  leds.show()
end)

local function chosen() return math.floor(where:fraction() * (n - 1) + 0.5) end

function on_event(ctx, e)
  if e.name == "tap" and e.data.index == 0 then drop(chosen()) end
  if e.name == "trigger" and e.data.name == "drop" and e.data.pressed then drop(chosen()) end
end
