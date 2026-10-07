-- Life: Conway's Game of Life on a wrap-around matrix, cells coloured by age. Speed sets generations per second; Reseed or A starts afresh.
-- @output matrix
local W, H = leds.width(), leds.height()
local N = W * H
local speed = dial.new("speed", { label = "Generations/s", min = 1, max = 20, start = 6 })
local reseed = trigger.new("reseed", { label = "Reseed", key = "KeyR", via = "button" })

local age = {}   -- 0 = dead, else generations alive
local glow = {}  -- a dying cell's fading afterglow, 0..1
local next_age = {}
local seen = {}  -- recent states -> generation number, to spot loops
local history = {}
local HISTORY = 200 -- long enough to catch a glider lapping a 32×8 torus (128 generations)
local gen, acc, hue0 = 0, 0, 0
local stuck_ms = nil -- how long it's been dead or looping, nil while it's still going somewhere

-- Neighbour offsets with wrap-around, precomputed per cell.
local nbrs = {}
for y = 0, H - 1 do
  for x = 0, W - 1 do
    local t = {}
    for dy = -1, 1 do
      for dx = -1, 1 do
        if dx ~= 0 or dy ~= 0 then
          t[#t + 1] = ((y + dy) % H) * W + (x + dx) % W
        end
      end
    end
    nbrs[y * W + x] = t
  end
end

local function seed()
  for i = 0, N - 1 do
    age[i] = math.random() < 0.35 and 1 or 0
    glow[i] = 0
  end
  seen, history, gen, stuck_ms = {}, {}, 0, nil
  hue0 = math.random(0, 359)
end

local function key()
  local bits = {}
  for i = 0, N - 1 do bits[i + 1] = age[i] > 0 and "1" or "0" end
  return table.concat(bits)
end

-- One generation; returns the population.
local function step()
  local pop = 0
  for i = 0, N - 1 do
    local n = 0
    for _, j in ipairs(nbrs[i]) do
      if age[j] > 0 then n = n + 1 end
    end
    local a = age[i]
    if a > 0 and (n == 2 or n == 3) then
      next_age[i] = a + 1
    elseif a == 0 and n == 3 then
      next_age[i] = 1
    else
      next_age[i] = 0
      if a > 0 then glow[i] = 1 end
    end
    if next_age[i] > 0 then pop = pop + 1 end
  end
  age, next_age = next_age, age
  gen = gen + 1

  -- Loop detection: a state seen in the last HISTORY generations (still lifes and blinkers included).
  local k = key()
  if stuck_ms == nil and (pop == 0 or seen[k]) then stuck_ms = 0 end
  seen[k] = gen
  history[#history + 1] = k
  if #history > HISTORY then
    local old = table.remove(history, 1)
    if seen[old] and seen[old] <= gen - HISTORY then seen[old] = nil end
  end
  return pop
end

local function colour(a)
  if a == 1 then return leds.hsv(hue0, 0.2, 1) end -- newborn: nearly white
  local v = math.max(0.35, 1 - (a - 2) * 0.03)
  return leds.hsv(hue0 + 40 + math.min(a, 40) * 6, 1, v) -- hue walks on as cells age
end

seed()
leds.brightness(80)

leds.on_frame(function(ctx, dt_ms)
  if reseed:was_pressed() then seed() end

  local period = 1000 / speed:value()
  acc = acc + dt_ms
  local steps = 0
  while acc >= period and steps < 3 do
    acc = acc - period
    step()
    steps = steps + 1
  end
  if acc >= period then acc = 0 end -- don't spiral after a stall

  -- Dead or looping: let it be seen for a moment, then start again.
  if stuck_ms then
    stuck_ms = stuck_ms + dt_ms
    local pop = 0
    for i = 0, N - 1 do if age[i] > 0 then pop = pop + 1 end end
    if stuck_ms > (pop == 0 and 800 or 2500) then seed() end
  end

  local fade = dt_ms / 350
  for i = 0, N - 1 do
    local a = age[i]
    if a > 0 then
      leds.set(i, colour(a))
    elseif glow[i] > 0 then
      glow[i] = math.max(0, glow[i] - fade)
      leds.set(i, leds.hsv(hue0 + 200, 0.8, glow[i] * glow[i] * 0.3))
    else
      leds.set(i, 0)
    end
  end
  leds.show()
end)

function on_event(ctx, e)
  if e.name == "tap" and e.data.index == 0 then seed() end
end
