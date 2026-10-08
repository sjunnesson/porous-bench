-- Snake: a snake that plays itself on the matrix, steering for the food and growing as it eats. When it's boxed in, it flashes red and starts again; A starts it over. Speed sets its pace.
-- @output matrix
local W, H = leds.width(), leds.height()
local speed = dial.new("speed", { min = 1, max = 20, start = 8 })
local bright = dial.new("brightness", { min = 4, max = 255, step = 1, start = 80, via = "pot" })

local DIRS = { { 1, 0 }, { 0, 1 }, { -1, 0 }, { 0, -1 } }
local body, taken, food, grow, dead, hue0 -- head first; taken: cells under the body
local acc, t = 0, 0                       -- moves owed by the frame timer; seconds, for the food's pulse

local function cell(x, y) return y * W + x end

local function placeFood()
  local free = {}
  for i = 0, W * H - 1 do
    if not taken[i] then free[#free + 1] = i end
  end
  if #free == 0 then dead = 1.5 return end -- it filled the matrix: start again
  local i = free[math.random(#free)]
  food = { x = i % W, y = i // W }
end

local function reset()
  body = { { x = W // 2, y = H // 2 } }
  taken = { [cell(W // 2, H // 2)] = true }
  grow, dead, hue0 = 2, 0, math.random(0, 359)
  placeFood()
end
reset()

-- How many free cells it could still reach from (x, y), up to `limit`: a turn into a pocket smaller
-- than itself is a trap.
local function room(x, y, limit)
  local seen, stack, count = { [cell(x, y)] = true }, { { x, y } }, 0
  while #stack > 0 and count < limit do
    local c = table.remove(stack)
    count = count + 1
    for _, d in ipairs(DIRS) do
      local nx, ny = (c[1] + d[1]) % W, (c[2] + d[2]) % H
      local k = cell(nx, ny)
      if not seen[k] and not taken[k] then
        seen[k] = true
        stack[#stack + 1] = { nx, ny }
      end
    end
  end
  return count
end

local function move()
  local head, best, bestScore = body[1], nil, math.huge
  for _, d in ipairs(DIRS) do
    local nx, ny = (head.x + d[1]) % W, (head.y + d[2]) % H -- the edges wrap
    if not taken[cell(nx, ny)] then
      local dx, dy = math.abs(nx - food.x), math.abs(ny - food.y)
      local score = math.min(dx, W - dx) + math.min(dy, H - dy)
      if room(nx, ny, #body + 2) < #body + 2 then score = score + 1000 end
      if score < bestScore then best, bestScore = { x = nx, y = ny }, score end
    end
  end
  if not best then dead = 1.5 return end

  table.insert(body, 1, best)
  taken[cell(best.x, best.y)] = true
  if best.x == food.x and best.y == food.y then
    grow = grow + 1
    placeFood()
  end
  if grow > 0 then
    grow = grow - 1
  else
    local tail = table.remove(body)
    taken[cell(tail.x, tail.y)] = nil
  end
end

leds.on_frame(function(ctx, dt_ms)
  local dt = dt_ms / 1000
  t = t + dt
  leds.clear()
  if dead > 0 then
    dead = dead - dt
    local on = math.floor(dead * 6) % 2 == 0
    for _, p in ipairs(body) do leds.set(leds.xy(p.x, p.y), on and 0xff0000 or 0x200000) end
    if dead <= 0 then reset() end
  else
    acc = acc + speed:value() * dt
    while acc >= 1 and dead <= 0 do
      acc = acc - 1
      move()
    end
    local n = #body
    for k, p in ipairs(body) do
      local v = k == 1 and 1 or 0.9 - 0.6 * (k - 1) / n -- the head brightest, the tail dimmest
      leds.set(leds.xy(p.x, p.y), leds.hsv(hue0 + k * 7, k == 1 and 0.4 or 1, v))
    end
    if food then leds.set(leds.xy(food.x, food.y), leds.hsv(0, 1, 0.6 + 0.4 * math.sin(t * 7))) end
  end
  leds.brightness(bright:value())
  leds.show()
end)

function on_event(ctx, e)
  if e.name == "tap" and e.data.index == 0 then reset() end
end
