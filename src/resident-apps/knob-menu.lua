-- Knob menu: an LVGL settings menu. Turn to move (the highlight glides to the row), push to edit, B to back out; a second dial sweeps the gauge arc and Brightness sets the real backlight.
local h = lvgl.bind("main")
local s = screens.get("main")
local W, H = h.HOR_RES(), h.VER_RES()
-- Round glass (shape "round"): lay everything out in the square inside the circle.
local ui = h
if s.shape == "round" then
  local side = math.floor(math.min(W, H) * 0.7071)
  local box = h.Object { x = (W - side) // 2, y = (H - side) // 2, w = side, h = side,
    bg_opa = 0, border_width = 0, pad_all = 0, radius = 0 }
  ui = setmetatable({}, { __index = function(_, kind) return function(props) return box[kind](box, props) end end })
  W, H = side, side
end
local color = s.depth == 16
local paper = s.scheme == "light" -- e-paper: every LVGL refresh is a slow refresh, so nothing animates
local canDim = not paper

-- The hardware this app wants on the desk. Each can be swapped in Connections without touching code.
local move = dial.new("move") -- open range: only its steps matter
local select = trigger.new("select", { key = "Enter", via = "encoder-push" })
local gauge = dial.new("gauge", { min = 0, max = 4095, step = 1, start = 1640, via = "pot",
  keys = { down = "BracketLeft", up = "BracketRight" } })

local settings = { brightness = 80, hue = 200, animate = true, invert = false }
local cursor, editing = 1, false

local function clamp(v, lo, hi) return math.max(lo, math.min(hi, v)) end

local items = {
  { label = "Brightness", value = function() return settings.brightness .. "%" end,
    adjust = function(c) settings.brightness = clamp(settings.brightness + c * 5, 5, 100) end },
  { label = "Accent", value = function() return settings.hue .. "deg" end,
    adjust = function(c) settings.hue = (settings.hue + c * 10) % 360 end },
  { label = "Animate", value = function() return settings.animate and "on" or "off" end,
    adjust = function() settings.animate = not settings.animate end },
  { label = "Invert", value = function() return settings.invert and "on" or "off" end,
    adjust = function() settings.invert = not settings.invert end },
  { label = "Gauge", value = function() return tostring(gauge:value()) end },
}

local function hsv(hue, sat, v)
  hue = hue % 360
  local c = v * sat
  local x = c * (1 - math.abs((hue / 60) % 2 - 1))
  local r, gr, b
  if hue < 60 then r, gr, b = c, x, 0
  elseif hue < 120 then r, gr, b = x, c, 0
  elseif hue < 180 then r, gr, b = 0, c, x
  elseif hue < 240 then r, gr, b = 0, x, c
  elseif hue < 300 then r, gr, b = x, 0, c
  else r, gr, b = c, 0, x end
  local m = v - c
  local function byte(u) return math.floor((u + m) * 255 + 0.5) end
  return (byte(r) << 16) | (byte(gr) << 8) | byte(b)
end

-- Colours for the current settings. 1-bit panels get pure black and white only.
local function palette()
  local light = settings.invert ~= paper -- e-paper is light by nature; Invert flips either way
  if color then
    return {
      bg = light and 0xF2F2F5 or 0x0C0C12, fg = light and 0x16161C or 0xECECF2,
      dim = light and 0xCFCFD8 or 0x2C2C3A, onAccent = 0x000000,
      accent = hsv(settings.hue, 0.75, light and 0.85 or 1),
      dot = hsv(settings.hue + 120, 0.7, light and 0.8 or 1),
    }
  end
  local bg, fg = light and 0xFFFFFF or 0x000000, light and 0x000000 or 0xFFFFFF
  return { bg = bg, fg = fg, dim = bg, onAccent = bg, accent = fg, dot = fg }
end
local pal = palette()

-- Only send properties that changed: on e-paper every change is a refresh.
local sent = {}
local function put(obj, props)
  local c = sent[obj]
  if not c then c = {} sent[obj] = c end
  local diff
  for k, v in pairs(props) do
    if c[k] ~= v then c[k] = v diff = diff or {} diff[k] = v end
  end
  if diff then obj:set(diff) end
end

-- Move a value with an Anim (ease_out), reusing one Anim per slot so a new target restarts it from
-- wherever it is now. On e-paper it jumps to the end instead.
local function glide(a, obj, from, to, ms, cb)
  if a then a:stop() end
  if from == to then return a end
  if paper then cb(obj, to) return a end
  local para = { start_value = from, end_value = to, duration = ms, path = "ease_out", exec_cb = cb, run = true }
  if a then return a:set(para) end
  return obj:Anim(para)
end

-- ── layout ────────────────────────────────────────────────────────────────

local big = H >= 200 and W >= 160
local corner = (color and H > W * 1.5) and 10 or 0 -- tall LCDs (the C6 1.47) have rounded corners
local rowH = big and (H >= 300 and 30 or 26) or (H >= 120 and 22 or 16)
local titleH = H >= 64 and (big and 28 or (H >= 120 and 20 or 16)) or 0
local pad = big and 8 or 4
local gap = rowH >= 20 and 2 or 1
local top = titleH > 0 and corner + titleH or 0

local hasGauge = H >= 120
local side = hasGauge and W >= H * 1.5 -- landscape: the gauge sits right of the list
local listW = side and W - math.max(80, W // 3 + 10) or W
local room = H - top - corner
if hasGauge and not side then room = room - math.max(56, room - #items * rowH) end
local visible = clamp(room // rowH, 1, #items)
local viewH = visible * rowH

h:set_theme {
  screen = { bg_color = pal.bg, bg_opa = 255 },
  object = { bg_opa = 0, border_width = 0, pad_all = 0, radius = 0,
    pad_top = 0, pad_bottom = 0, pad_left = 0, pad_right = 0 },
  label = { text_color = pal.fg, text_font = lvgl.Font("montserrat", big and 16 or 14) },
}

local titleBar, titleLabel
if titleH > 0 then
  titleBar = ui.Object { x = 0, y = 0, w = W, h = top - gap, bg_opa = 255 }
  titleLabel = titleBar:Label { text = "MENU", align = lvgl.ALIGN.CENTER, y = corner // 2 }
end

-- The viewport clips the list; the list slides (translate_y) when the cursor leaves the view.
local view = ui.Object { x = 0, y = top, w = listW, h = viewH }
local list = view:Object { x = 0, y = 0, w = listW, h = #items * rowH }
-- The highlight is made first so it sits behind the rows, and glides between them.
local hl = list:Object { x = 2, y = gap // 2, w = listW - 4, h = rowH - gap, radius = big and 5 or 3 }
local rows = {}
for i, it in ipairs(items) do
  local row = list:Object { x = 0, y = (i - 1) * rowH, w = listW, h = rowH }
  rows[i] = {
    name = row:Label { text = it.label, align = lvgl.ALIGN.LEFT_MID, x = pad },
    value = row:Label { text = it.value(), align = lvgl.ALIGN.RIGHT_MID, x = -pad },
  }
end

-- The gauge: a bottom half-dial Arc, a 1 px track ring on 1-bit panels, and the orbiting dot.
local arc, ring, dot
local cx, cy, Ro, DOT = 0, 0, 0, 0
if hasGauge then
  local gx, gy = side and listW or 0, side and top or top + viewH
  local gw, gh = W - gx, H - corner - gy
  local box = ui.Object { x = gx, y = gy, w = gw, h = gh }
  local AW = big and 8 or 5
  DOT = big and 8 or 6
  local knobR = AW // 2 + 1
  Ro = math.min(gw // 2 - DOT // 2 - 2, gh - DOT // 2 - knobR - 8, 80) -- the dot's orbit
  local R = Ro - DOT // 2 - AW // 2 - 3 -- the arc's centre line
  cx = gw // 2
  cy = (gh - (Ro + DOT // 2 + knobR)) // 2 + Ro + DOT // 2
  arc = box:Arc { x = cx - R - AW // 2, y = cy - R - AW // 2, w = 2 * R + AW, h = 2 * R + AW,
    arc_width = AW, range = { 0, 4095 }, value = gauge:value(),
    bg_start_angle = 180, bg_end_angle = 360, rotation = 0 }
  if not color then
    ring = box:Arc { x = cx - R, y = cy - R, w = 2 * R + 1, h = 2 * R + 1, arc_width = 1, value = 100,
      bg_start_angle = 180, bg_end_angle = 360, rotation = 0 }
    ring:set_style({ bg_opa = 0 }, lvgl.PART.KNOB)
  end
  dot = box:Object { w = DOT, h = DOT, radius = lvgl.RADIUS_CIRCLE, bg_opa = 255 }
end

-- ── state → widgets ───────────────────────────────────────────────────────

-- Which row's text sits on the filled highlight (none while editing: the highlight is an outline).
local hlY, litRow = 0, nil
local function light(force)
  local lit = editing and 0 or clamp((hlY + rowH // 2) // rowH + 1, 1, #items)
  if lit == litRow and not force then return end
  litRow = lit
  for i, r in ipairs(rows) do
    local c = i == lit and pal.onAccent or pal.fg
    put(r.name, { text_color = c })
    put(r.value, { text_color = c })
  end
end

local function applyMode()
  if editing then put(hl, { bg_opa = 0, border_width = big and 2 or 1, border_color = pal.accent })
  else put(hl, { bg_opa = 255, bg_color = pal.accent, border_width = 0 }) end
  if titleLabel then put(titleLabel, { text = editing and "EDIT" or "MENU" }) end
  light(true)
end

local styled = {}
local function applyPalette()
  pal = palette()
  put(h.screen(), { bg_color = pal.bg })
  if titleBar then
    put(titleBar, { bg_color = pal.accent })
    put(titleLabel, { text_color = pal.onAccent })
  end
  applyMode()
  if arc then
    if styled.dim ~= pal.dim or styled.fg ~= pal.fg then -- the track and knob are parts: restyle on a change
      styled.dim, styled.fg = pal.dim, pal.fg
      arc:set_style({ arc_color = pal.dim }, lvgl.PART.MAIN)
      arc:set_style({ bg_color = pal.fg, pad_all = 1 }, lvgl.PART.KNOB)
    end
    put(arc, { arc_color = pal.accent }) -- set{arc_color} on an Arc colours the indicator
    if ring then put(ring, { arc_color = pal.fg }) end
    put(dot, { bg_color = pal.dot })
  end
end

-- The cursor: the highlight glides to the row, and the list scrolls to keep it in view.
local hlAnim, scrollAnim, listY, first = nil, nil, 0, 0
local function moveCursor()
  hlAnim = glide(hlAnim, hl, hlY, (cursor - 1) * rowH, 150, function(obj, v)
    hlY = v
    obj:set { translate_y = v }
    light()
  end)
  local f = first
  if cursor > f + visible then f = cursor - visible elseif cursor <= f then f = cursor - 1 end
  if f ~= first then
    first = f
    scrollAnim = glide(scrollAnim, list, listY, -f * rowH, 150, function(obj, v)
      listY = v
      obj:set { translate_y = v }
    end)
  end
end

-- The gauge's indicator chases the dial.
local gaugeAnim, gaugeV = nil, gauge:value()
local function moveGauge(v)
  if not arc then return end
  gaugeAnim = glide(gaugeAnim, arc, gaugeV, v, 200, function(obj, x)
    gaugeV = x
    obj:set { value = x }
  end)
end

-- The dot sweeps over the top of the dial and back, forever, while Animate is on.
local orbit
local function placeDot(obj, deg)
  local a = math.rad(deg)
  obj:set { x = cx + math.floor(math.cos(a) * Ro + 0.5) - DOT // 2,
            y = cy + math.floor(math.sin(a) * Ro + 0.5) - DOT // 2 }
end
local function applyAnimate()
  if not dot then return end
  if settings.animate then
    dot:clear_flag(lvgl.FLAG.HIDDEN)
    if paper then placeDot(dot, 270) -- e-paper: park it at the top
    elseif not orbit then
      orbit = dot:Anim { start_value = 180, end_value = 360, duration = 900, playback_time = 900,
        path = "ease_in_out", repeat_count = lvgl.ANIM_REPEAT_INFINITE, exec_cb = placeDot, run = true }
    end
  else
    if orbit then orbit:delete() orbit = nil end
    dot:add_flag(lvgl.FLAG.HIDDEN)
  end
end

local lastBright
local function applyBrightness()
  if canDim and settings.brightness ~= lastBright then
    lastBright = settings.brightness
    screens.set("main", { brightness = settings.brightness / 100 })
  end
end

local function applySetting(i)
  put(rows[i].value, { text = items[i].value() })
  if i == 1 then applyBrightness()
  elseif i == 2 or i == 4 then applyPalette()
  elseif i == 3 then applyAnimate() end
end

applyPalette()

local lastGauge = gauge:value()
function init(ctx)
  applyBrightness()
  applyAnimate()
end

function on_tick(ctx, dt_ms)
  local clicks = move:delta()
  if select:was_pressed() and items[cursor].adjust then
    editing = not editing
    applyMode()
  end
  if clicks ~= 0 then
    if editing then
      items[cursor].adjust(clicks)
      applySetting(cursor)
    else
      local c = clamp(cursor + clicks, 1, #items)
      if c ~= cursor then cursor = c moveCursor() end
    end
  end
  local v = gauge:value()
  if v ~= lastGauge then
    lastGauge = v
    put(rows[5].value, { text = items[5].value() })
    moveGauge(v)
  end
end

function on_event(ctx, e)
  if e.name == "tap" and e.data.index == 1 and editing then
    editing = false
    applyMode()
  end
end
