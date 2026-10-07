-- Night light: a warm glow when someone's there, brighter the darker the room.
-- @output strip
-- Touch both sensors first so they're on the bench and the controls below connect to them.
pir.read()
light.read()
local presence = trigger.new("presence", { key = "KeyM", via = "motion" })
local room = dial.new("room", { min = 0, max = 100, start = 30, via = "light" })

local n = leds.count()
local STAY_MS = 10000
local on, last_seen = false, -STAY_MS
local level = 0 -- 0..1, eased toward the target in on_frame
local t = 0

function on_tick(ctx)
  if presence:was_pressed() or presence:is_pressed() then
    last_seen = ctx.time_ms
    if not on then
      on = true
      log.info("motion: fading in")
    end
  elseif on and ctx.time_ms - last_seen > STAY_MS then
    on = false
    log.info("no motion for 10 s: fading out")
  end
end

leds.on_frame(function(ctx, dt_ms)
  -- Dark room -> up to ~80 % of 255; bright room -> a faint 12 %.
  local target = on and (0.8 - 0.68 * room:fraction()) or 0
  local tau = target > level and 700 or 1600 -- fade in over ~2 s, out over ~5 s
  level = level + (target - level) * (1 - math.exp(-dt_ms / tau))

  -- A warm white with a slow, faint candle-like drift so it feels alive.
  t = t + dt_ms / 1000
  for i = 0, n - 1 do
    local w = 0.9 + 0.1 * math.sin(t * 0.7 + i * 0.9) * math.sin(t * 0.43 + i * 0.37)
    leds.set_rgb(i, math.floor(255 * w), math.floor(140 * w), math.floor(48 * w))
  end
  leds.brightness(255 * level * level) -- squared: fades look even to the eye
  leds.show()
end)
