-- Lua probe: how fast the guition-4848 firmware's Lua allocates (one loop a tick, three runs each, on serial as [probe] lines), what the sandbox refuses, then a clipped scene of pushImage tiles and palette sprites redrawn every tick. Push it over serial with a BENCH_PROFILE build (README, "Speed and memory").
local g = lgfx.bind("main")
local W, H = g:width(), g:height()
local char, concat, fmt = string.char, table.concat, string.format
local ms, diff = time.ticks_ms, time.ticks_diff

-- What the sandbox lets an app do (0.14 narrows setmetatable, collectgarbage and string.dump).
local function try(f) local ok, err = pcall(f) return ok and "allowed" or ("refused: " .. tostring(err):sub(1, 60)) end

local LOOPS = {
  { "10000 {i,i+1,i+2}", function() for i = 1, 10000 do local t = { i, i + 1, i + 2 } end end },
  { "10000 {x=i,y=i+1}", function() for i = 1, 10000 do local t = { x = i, y = i + 1 } end end },
  { "10000 closures", function() for i = 1, 10000 do local f = function() return i end; f() end end },
  { "5000 \"a\"..i", function() for i = 1, 5000 do local s = "a" .. i end end },
  { "3000 string.format", function() for i = 1, 3000 do local s = fmt("%d:%02d", i // 60, i % 60) end end },
  { "20000 math.sin(large)", function() local s = 0 for i = 1, 20000 do s = s + math.sin(i * 12.9898 + 311.7) end end },
}
local RUNS = 3
local step, results = 0, {}

-- A 32x32 RGB565 tile (big-endian) and a 24x24 palette sprite with a transparent index 0.
local function tile()
  local px = {}
  for y = 0, 31 do for x = 0, 31 do
    local c = ((x * 8) >> 3) << 11 | ((y * 8) >> 2) << 5 | (((x + y) * 4) >> 3)
    px[#px + 1] = char(c >> 8 & 0xFF, c & 0xFF)
  end end
  return concat(px)
end
local TILE = tile()
local PAL = char(0, 0, 0xF8, 0x00, 0x07, 0xE0, 0xFF, 0xFF) -- 0 (transparent), red, green, white
local SPRITE = {}
for y = 0, 23 do for x = 0, 23 do
  local d = (x - 12) ^ 2 + (y - 12) ^ 2
  SPRITE[#SPRITE + 1] = char(d < 36 and 3 or d < 100 and 1 + (x + y) % 2 or 0)
end end
SPRITE = concat(SPRITE)

local ticks, drawMs, dtSum, frame = 0, 0, 0, 0
local function scene()
  local t0 = ms()
  frame = frame + 1
  g:setClipRect(80, 80, 320, 320)
  for y = 0, H - 1, 32 do for x = 0, W - 1, 32 do g:pushImage(x, y, 32, 32, TILE) end end
  for i = 0, 11 do
    local a = frame * 0.05 + i * 0.5236
    g:pushImage(240 + math.floor(math.cos(a) * 150) - 12, 240 + math.floor(math.sin(a) * 150) - 12, 24, 24, SPRITE, PAL, 0)
  end
  g:clearClipRect()
  g:flip()
  drawMs = drawMs + diff(ms(), t0)
end

function init(ctx)
  log.info("[probe] __gc metatable " .. try(function() setmetatable({}, { __gc = function() end }) end))
  log.info("[probe] collectgarbage('stop') " .. try(function() collectgarbage("stop") collectgarbage("restart") end))
  log.info("[probe] string.dump " .. (string.dump and "present" or "absent"))
  g:fillScreen(0x000000)
  g:flip()
end

function on_tick(ctx, dt_ms)
  if step < #LOOPS * RUNS then
    local l = LOOPS[step // RUNS + 1]
    collectgarbage()
    local t0 = ms()
    l[2]()
    local took = diff(ms(), t0)
    results[#results + 1] = took
    if step % RUNS == RUNS - 1 then
      log.info(fmt("[probe] %s: %s ms", l[1], concat(results, " ")))
      results = {}
    end
    step = step + 1
    return
  end
  scene()
  ticks, dtSum = ticks + 1, dtSum + dt_ms
  if ticks == 300 then
    log.info(fmt("[probe] scene: %.1f ms a draw, a tick every %.1f ms, %.1f KB Lua", drawMs / ticks, dtSum / ticks, collectgarbage("count")))
    ticks, drawMs, dtSum = 0, 0, 0
  end
end
