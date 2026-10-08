-- Ring clock: the time as dots going round a ring from the top (or along a strip from LED 0): blue hours, green minutes and a red second gliding between LEDs. A hides the seconds.
-- @output strip
local bright = dial.new("brightness", { min = 4, max = 255, step = 1, start = 80, via = "pot" })

local n = leds.count()
local r, g, b = {}, {}, {}
local lastSec, sub = -1, 0   -- the second shown, and how far into it the frame timer is
local t = 0                  -- seconds, for the waiting pulse
local seconds = true

-- Add colour c at a fractional position, shared between the two LEDs either side of it.
local function add(pos, c, w)
  pos = pos % n
  local i0 = math.floor(pos)
  local f = pos - i0
  for _, side in ipairs({ { i0, (1 - f) * w }, { (i0 + 1) % n, f * w } }) do
    local i, k = side[1], side[2]
    r[i] = r[i] + ((c >> 16) & 255) * k
    g[i] = g[i] + ((c >> 8) & 255) * k
    b[i] = b[i] + (c & 255) * k
  end
end

leds.on_frame(function(ctx, dt_ms)
  t = t + dt_ms / 1000
  for i = 0, n - 1 do r[i], g[i], b[i] = 0, 0, 0 end
  -- Faint marks at 12, 3, 6 and 9.
  for q = 0, 3 do add(q * n / 4, 0xffffff, 0.06) end

  if not datetime.synced() then
    add(0, 0xffffff, 0.3 + 0.3 * math.sin(t * 3)) -- no time yet: a slow pulse at 12
  else
    local now = datetime.now()
    if now.second ~= lastSec then
      lastSec, sub = now.second, 0
    else
      sub = math.min(0.99, sub + dt_ms / 1000)
    end
    local s = now.second + sub
    local m = now.minute + s / 60
    local h = now.hour % 12 + m / 60
    add(h / 12 * n, 0x0030ff, 1)
    add(m / 60 * n, 0x00ff30, 1)
    if seconds then add(s / 60 * n, 0xff1000, 0.8) end
  end

  for i = 0, n - 1 do
    leds.set_rgb(i, math.floor(math.min(255, r[i])), math.floor(math.min(255, g[i])), math.floor(math.min(255, b[i])))
  end
  leds.brightness(bright:value())
  leds.show()
end, 30)

function on_event(ctx, e)
  if e.name == "tap" and e.data.index == 0 then seconds = not seconds end
end
