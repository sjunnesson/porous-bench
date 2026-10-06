-- Characters: Montserrat at a few sizes and a walking pixel-art robot, all LVGL Anims. A = jump; Walk speed can be the encoder, the pot or IMU tilt.
local h = lvgl.bind("main")
local s = screens.get("main")
local W, H = h.HOR_RES(), h.VER_RES()
local color = s.depth == 16
local paper = s.scheme == "light" -- e-paper: every LVGL refresh is a slow refresh, so no Anims
local BG = paper and 0xFFFFFF or 0x000000
local FG = paper and 0x000000 or 0xFFFFFF
local floor, abs, max, min = math.floor, math.abs, math.max, math.min

local speed = dial.new("walk_speed", { label = "Walk speed", min = -6, max = 6, start = 2 })

local function font(n) return lvgl.Font("montserrat", n) end
local function lineH(n) return math.ceil(n * 1.17) end -- Montserrat line height at n px

h:set_theme {
  screen = { bg_color = BG },
  object = { bg_opa = 0, border_width = 0, pad_all = 0, radius = 0 },
  label = { text_color = FG, text_font = font(14) },
}

-- Anims everywhere but e-paper, where we jump straight to the end state.
local function anim(obj, para)
  if paper then
    if para.exec_cb then para.exec_cb(obj, para.end_value) end
    return nil
  end
  para.run = para.run ~= false
  return obj:Anim(para)
end

-- ── text samples ───────────────────────────────────────────────────────────

local sizes = H >= 200 and { 14, 20, 28 } or (H >= 100 and { 14, 20 } or (H >= 64 and { 8, 14 } or { 8 }))
local tints = { 0xFFD27F, 0x7FFFB2, 0x7FB2FF }
local LONG, SHORT = "ABC abc 0123 !?#", "Abc 123 !?"
local gap = H >= 100 and 3 or 1
local y = H >= 200 and 8 or 1 -- tall panels have rounded corners: keep clear of them
for i, size in ipairs(sizes) do
  local text = i == 1 and ((#LONG * 0.62 * size <= W - 8) and LONG or SHORT)
      or (i == 2 and "Size " or "Big ") .. size
  h.Label {
    text = text, align = lvgl.ALIGN.TOP_MID, y = y, text_font = font(size),
    text_color = color and tints[i] or FG,
  }
  y = y + lineH(size) + gap
end
local textBottom = y

-- ── the robot ──────────────────────────────────────────────────────────────

-- Two-frame walking robot, one letter per colour; '.' is transparent.
local HEAD = {
  "......r.....",
  "......g.....",
  "..########..",
  ".##########.",
  ".##ww##ww##.",
  ".##wp##wp##.",
  ".##########.",
  ".###mmmm###.",
  "..########..",
  "...gggggg...",
  ".g.######.g.",
  "g..######..g",
}
local LEGS = { { "...##..##...", "..gg....gg.." }, { "....#..#....", "....gg.gg..." } }
local PALETTE = color
    and { ["#"] = 0x87CEEB, w = 0xFFFFFF, p = 0x000000, m = 0x000080, g = 0xC0C0C0, r = 0xFF0000 }
    -- 1-bit: body lit, eye sockets and mouth dark, pupils lit.
    or { ["#"] = FG, w = BG, p = FG, m = BG, g = FG, r = FG }
local SW, SH = 12, #HEAD + 2
local scale = H >= 200 and 3 or (H >= 100 and 2 or 1)
local sw, sh = SW * scale, SH * scale
local groundY = H - (H >= 200 and 12 or 3)

-- Pixels → rects: horizontal runs of one colour, stacked into one taller rect when the row below
-- has the same run. Background-coloured pixels are left out (the screen shows through).
local function rects(rows, flip)
  local out, open = {}, {}
  for r, row in ipairs(rows) do
    local nextOpen = {}
    local function at(i) return PALETTE[row:sub(flip and SW + 1 - i or i, flip and SW + 1 - i or i)] end
    local i = 1
    while i <= SW do
      local c = at(i)
      if c == nil or c == BG then
        i = i + 1
      else
        local j = i
        while j < SW and at(j + 1) == c do j = j + 1 end
        local key = i .. ":" .. j .. ":" .. c
        local rc = open[key]
        if rc then rc.h = rc.h + 1 else
          rc = { x = i - 1, y = r - 1, w = j - i + 1, h = 1, c = c }
          out[#out + 1] = rc
        end
        nextOpen[key] = rc
        i = j + 1
      end
    end
    open = nextOpen
  end
  return out
end

local function paint(parent, rows, flip)
  for _, rc in ipairs(rects(rows, flip)) do
    parent:Object({ x = rc.x * scale, y = rc.y * scale, w = rc.w * scale, h = rc.h * scale,
      bg_color = rc.c, bg_opa = 255 })
  end
end

-- walker (moves across: translate_x) > jumper (hops: translate_y) > one container per facing,
-- each with the head and one container per leg frame.
local walker = h.Object { x = 0, y = groundY - sh, w = sw, h = sh }
local jumper = walker:Object({ w = sw, h = sh })
walker:add_flag(lvgl.FLAG.OVERFLOW_VISIBLE)
jumper:add_flag(lvgl.FLAG.OVERFLOW_VISIBLE)
local facing, legs = {}, {}
for _, d in ipairs({ 1, -1 }) do
  local f = jumper:Object({ w = sw, h = sh })
  paint(f, HEAD, d < 0)
  legs[d] = {}
  for k, frame in ipairs(LEGS) do
    local l = f:Object({ y = #HEAD * scale, w = sw, h = 2 * scale })
    paint(l, frame, d < 0)
    legs[d][k] = l
  end
  facing[d] = f
end

h.Object { x = 0, y = groundY, w = W, h = 1, bg_color = color and 0x006400 or FG, bg_opa = 255 } -- the ground

-- Speech bubble, riding on the jumper so it follows every step and hop.
local LINES = { "Hello!", "Beep boop.", "Nice screen.", "Press A", "to jump!" }
local bfont = scale >= 2 and 14 or 8
local padH, padV = scale >= 2 and 5 or 3, scale >= 2 and 2 or 1
local bubble = jumper:Label {
  text = LINES[1], align = lvgl.ALIGN.OUT_TOP_MID, y = -2,
  bg_color = FG, bg_opa = 255, text_color = BG, radius = 4,
  pad_hor = padH, pad_ver = padV, text_font = font(bfont),
}
local talks = groundY - sh - 2 - (lineH(bfont) + 2 * padV) >= textBottom
if not talks then bubble:add_flag(lvgl.FLAG.HIDDEN) end
local bubbleW = bubble:get_width()

-- ── state → widgets ────────────────────────────────────────────────────────

local x = floor(W / 3)  -- left edge of the robot, in [-sw, W)
local span = W + sw     -- one lap: fully off one side to fully off the other
local dir, frame = 1, 1
local v = nil           -- the walk speed the running anim was built for

-- Keep the bubble on screen while the robot is near an edge.
local function clampBubble()
  local left = x + (sw - bubbleW) // 2
  local want = max(1, min(W - bubbleW - 1, left))
  bubble:set { translate_x = want - left }
end

local function place(nx)
  x = nx
  walker:set { translate_x = x }
  clampBubble()
end

local function setFrame(f)
  frame = f
  for _, d in ipairs({ 1, -1 }) do
    for k = 1, 2 do
      if k == f then legs[d][k]:clear_flag(lvgl.FLAG.HIDDEN) else legs[d][k]:add_flag(lvgl.FLAG.HIDDEN) end
    end
  end
end

local function setFacing(d)
  dir = d
  if d > 0 then
    facing[1]:clear_flag(lvgl.FLAG.HIDDEN) facing[-1]:add_flag(lvgl.FLAG.HIDDEN)
  else
    facing[-1]:clear_flag(lvgl.FLAG.HIDDEN) facing[1]:add_flag(lvgl.FLAG.HIDDEN)
  end
end

-- Leg frames: a Timer, its period following the speed (paused when standing).
local legTimer = not paper and lvgl.Timer {
  period = 200, cb = function() setFrame(3 - frame) end,
} or nil

-- The walk: one linear Anim over a lap's phase; exec_cb wraps it to a position. A new speed
-- rebuilds it from where the robot is now, so it never jumps.
local walk = nil
local function startWalk(nv)
  v = nv
  if walk then walk:delete() walk = nil end
  if v ~= 0 then setFacing(v > 0 and 1 or -1) end
  if v == 0 or paper then
    if legTimer then legTimer:pause() end
    setFrame(1)
    return
  end
  local origin = x + sw
  walk = anim(walker, {
    start_value = 0, end_value = v > 0 and span or -span,
    duration = floor(span * 1000 / (abs(v) * 15 * scale)),
    path = "linear", repeat_count = lvgl.ANIM_REPEAT_INFINITE,
    exec_cb = function(_, p) place((origin + p) % span - sw) end,
  })
  legTimer:set { period = max(33, floor(1000 / (abs(v) * 3))) }
  legTimer:resume()
end

-- The jump: up with ease_out, played back down.
local lift = floor(sh * 0.9)
local jumping = false
local jump = anim(jumper, {
  start_value = 0, end_value = -lift, duration = 300, playback_time = 300, path = "ease_out",
  exec_cb = function(obj, p) obj:set { translate_y = p } end,
  done_cb = function() jumping = false end,
  run = false,
})
if paper then jumper:set { translate_y = 0 } end -- the helper applied the end state; start grounded

setFacing(1)
setFrame(1)
place(x)
startWalk(speed:value())

-- ── ticks: state only ──────────────────────────────────────────────────────

local line, lineAt = 1, 0
local function nextLine()
  if not talks then return end
  line = line % #LINES + 1
  bubble:set { text = LINES[line] }
  bubbleW = bubble:get_width()
  clampBubble()
end

local PAPER_STEP = 3000 -- ms between e-paper frames
local wait = 0

function on_tick(ctx, dt_ms)
  if paper then
    wait = wait + dt_ms
    if wait < PAPER_STEP then return end
    wait = 0
    -- One discrete step: a stride across, the other leg, the next line, and back on the ground.
    local nv = speed:value()
    if nv ~= 0 then setFacing(nv > 0 and 1 or -1) end
    place((x + sw + nv * 4 * scale) % span - sw)
    if nv ~= 0 then setFrame(3 - frame) end
    jumper:set { translate_y = 0 }
    nextLine()
    return
  end
  local nv = speed:value()
  if nv ~= v then startWalk(nv) end
  lineAt = lineAt + dt_ms
  if lineAt >= 2500 then
    lineAt = 0
    nextLine()
  end
end

function on_event(ctx, e)
  if e.name == "tap" and e.data.index == 0 then
    if paper then
      jumper:set { translate_y = -lift } -- in the air until the next e-paper step
    elseif not jumping then
      jumping = true
      jump:start()
    end
  end
end
