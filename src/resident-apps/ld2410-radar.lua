-- LD2410 radar: a presence dashboard for the LD2410 radar. Drag the character in the radar, or let it wander.
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
local paper = s.scheme == "light" -- e-paper: no animation; update on a state change or every 10 s
local tiny = H < 48 -- 128x32 OLED: just state + distance
local wide = W > H
local rounded = color and W < H -- 172x320 has rounded corners: keep clear of them
local MAX_CM = 600

ld2410.begin({ mode = "wander" })

-- ── palette and theme ──────────────────────────────────────────────────────

local BG, FG, DIM
if paper then BG, FG, DIM = "#ffffff", "#000000", "#000000"
elseif color then BG, FG, DIM = "#000000", "#ececf2", "#9a9aae"
else BG, FG, DIM = "#000000", "#ffffff", "#ffffff" end -- 1-bit OLED: lit or not
local ORANGE, GREEN, GREY = "#ffa500", "#34c759", "#7b7d7b"

local function font(n) return lvgl.Font("montserrat", n) end
local function lineH(n) return math.ceil(n * 1.17) end

h:set_theme {
  screen = { bg_color = BG, bg_opa = 255 },
  -- The pads are spelled out too: Bench's renderer doesn't expand pad_all inside a theme.
  object = { bg_opa = 0, border_width = 0, radius = 0,
    pad_all = 0, pad_top = 0, pad_bottom = 0, pad_left = 0, pad_right = 0 },
  label = { text_color = FG, text_font = font(14) },
}

-- One Anim per channel, restarted from where it is. On e-paper every refresh is slow, so jump
-- straight to the end state instead of animating.
local anims = {}
local function animate(key, obj, para)
  if paper then para.exec_cb(obj, para.end_value) return end
  para.run = true
  local a = anims[key]
  if a then a:set(para) else anims[key] = obj:Anim(para) end
end

local shown = {}
local function text(lbl, t)
  if lbl and shown[lbl] ~= t then shown[lbl] = t lbl:set { text = t } end
end

local function metres(cm) return string.format("%.2f m", cm / 100) end

-- Badge look per state: the badge's props, its text colour, and the accent (marker) colour.
local function badgeLook(kind)
  if color then
    local c = kind == "MOVING" and ORANGE or kind == "PRESENT" and GREEN or GREY
    return { bg_color = c, bg_opa = 255, border_width = 0 }, "#000000", c
  end
  if kind ~= "EMPTY" then return { bg_color = FG, bg_opa = 255, border_width = 0 }, BG, FG end
  return { bg_opa = 0, border_width = paper and 2 or 1, border_color = FG }, FG, FG
end

-- ── widgets (built once) ───────────────────────────────────────────────────

local PX = tiny and 0 or rounded and 12 or W >= 160 and 6 or 3
local PY = tiny and 0 or rounded and 8 or 2
local CW = W - 2 * PX

local status, badge, badgeLabel, distance
local marker, gw = nil, 0 -- scale marker and the width of its track
local markerX, markerOpa, markerTarget = 0, 0, nil
local bars = {}
local lines, fw, fh, LW = nil, 0, 0, 1
local STEP, HMAX = 2, 0 -- history: px per sample, and how many samples fit

if tiny then
  local bw = 68
  badge = ui.Object { x = 0, y = 0, w = bw, h = H, radius = 4,
    transform_pivot_x = bw // 2, transform_pivot_y = H // 2 }
  badgeLabel = badge:Label { align = lvgl.ALIGN.CENTER, text = "", text_font = font(14) }
  distance = ui.Label { align = lvgl.ALIGN.RIGHT_MID, text = "-- m", text_font = font(16) }
else
  -- Header.
  local hf = H >= 100 and 14 or 8
  ui.Label { x = PX, y = PY, text = "LD2410", text_color = DIM, text_font = font(hf) }
  status = ui.Label { align = lvgl.ALIGN.TOP_RIGHT, x = -PX, y = PY, text = "", text_color = DIM,
    text_font = font(hf) }
  local y = PY + lineH(hf) + 2

  -- State badge, with the distance beside it (landscape) or under it (portrait).
  local bf, df
  if wide then bf, df = (H >= 120 and 20 or 14), (H >= 120 and 28 or 14)
  else bf, df = (W >= 200 and 28 or W >= 160 and 24 or 20), (H >= 200 and 28 or 16) end
  local bh = lineH(bf) + (H >= 100 and 8 or 4)
  local bw = wide and CW * 5 // 9 or CW
  badge = ui.Object { x = PX, y = y, w = bw, h = bh, radius = H >= 100 and 8 or 4,
    transform_pivot_x = bw // 2, transform_pivot_y = bh // 2 }
  badgeLabel = badge:Label { align = lvgl.ALIGN.CENTER, text = "", text_font = font(bf) }
  if wide then
    distance = ui.Label { align = lvgl.ALIGN.TOP_RIGHT, x = -PX, y = y + (bh - lineH(df)) // 2,
      text = "-- m", text_font = font(df) }
    y = y + bh + 4
  else
    y = y + bh + 4
    distance = ui.Label { align = lvgl.ALIGN.TOP_MID, y = y, text = "-- m", text_font = font(df) }
    y = y + lineH(df) + 2
  end

  -- 0..6 m scale: one polyline for the baseline and its ticks, and a round marker on it.
  local D = H >= 100 and 10 or 6
  local sh = D + 2
  local scale = ui.Object { x = PX, y = y, w = CW, h = sh }
  gw = CW - D
  local mid, tk, x0 = sh // 2, H >= 100 and 3 or 2, D // 2
  local pts = { { x0, mid } }
  for m = 0, 6 do
    local tx = x0 + gw * m // 6
    pts[#pts + 1] = { tx, mid }
    pts[#pts + 1] = { tx, mid - tk }
    pts[#pts + 1] = { tx, mid + tk }
    pts[#pts + 1] = { tx, mid }
  end
  scale:Line { points = pts, line_width = 1, line_color = color and "#5a5a6e" or FG }
  marker = scale:Object { x = 0, y = (sh - D) // 2, w = D, h = D, radius = lvgl.RADIUS_CIRCLE,
    bg_color = FG, bg_opa = 255, opa = 0 }
  y = y + sh + 4

  -- Move / still energy bars: a track with a fill whose width animates.
  if H >= 100 then
    local ef = W >= 160 and 14 or 8
    local lw = W >= 160 and 64 or 44
    local ebh = H >= 200 and 8 or 6
    local rowH = math.max(lineH(ef), ebh)
    local inset = color and 0 or 1 -- mono: an outlined track, the fill inside the border
    for i, name in ipairs { "move", "still" } do
      local label = ui.Label { x = PX, y = y + (rowH - lineH(ef)) // 2, text = name .. " 0",
        text_color = DIM, text_font = font(ef) }
      local track = ui.Object { x = PX + lw, y = y + (rowH - ebh) // 2, w = CW - lw, h = ebh,
        radius = ebh // 2, bg_color = "#1e1e28", bg_opa = color and 255 or 0,
        border_width = inset, border_color = FG }
      local fill = track:Object { w = 0, h = ebh - 2 * inset, radius = ebh // 2, bg_opa = 255,
        bg_color = color and (i == 1 and ORANGE or GREEN) or FG }
      bars[name] = { label = label, fill = fill, max = CW - lw - 2 * inset, w = 0, value = 0 }
      y = y + rowH + 3
    end
  end

  -- Distance history, newest on the right: a few Lines, one per run of samples with a target.
  local hh = H - PY - y
  if hh >= 10 then
    local frame = ui.Object { x = PX, y = y, w = CW, h = hh, border_width = 1,
      border_color = color and "#282830" or FG, radius = color and 4 or 0 }
    fw, fh = CW - 2, hh - 2
    LW = (color or paper) and 2 or 1
    HMAX = fw // STEP + 1
    lines = {}
    for i = 1, 6 do
      lines[i] = frame:Line { line_width = LW, line_color = color and "#00ffff" or FG, line_rounded = true }
      lines[i]:add_flag(lvgl.FLAG.HIDDEN)
    end
  end
end

-- ── updates (state only; the motion is in the Anims) ───────────────────────

local history = {} -- distance in cm per sample, or -1 when nobody's there
local hiddenLine = { true, true, true, true, true, true }

local function drawHistory()
  if not lines then return end
  local n, k, run = #history, 0, nil
  local span = fh - 1 - 2 * LW
  local function flush()
    if not run then return end
    if #run == 1 then run[2] = { run[1][1] + 1, run[1][2] } end
    k = k + 1
    lines[k]:set { points = run }
    if hiddenLine[k] then lines[k]:clear_flag(lvgl.FLAG.HIDDEN) hiddenLine[k] = false end
    run = nil
  end
  for i = n, 1, -1 do
    if k >= #lines then break end -- out of Lines: drop the oldest runs
    local v = history[i]
    if v >= 0 then
      run = run or {}
      run[#run + 1] = { fw - 1 - (n - i) * STEP, LW + span - span * math.min(v, MAX_CM) // MAX_CM }
    else
      flush()
    end
  end
  flush()
  for j = k + 1, #lines do
    if not hiddenLine[j] then lines[j]:add_flag(lvgl.FLAG.HIDDEN) hiddenLine[j] = true end
  end
end

local function setBar(name, e)
  local b = bars[name]
  if not b or e == b.value then return end
  b.value = e
  b.label:set { text = name .. " " .. e }
  local target = b.max * math.max(0, math.min(100, e)) // 100
  animate(name, b.fill, { start_value = b.w, end_value = target, duration = 300, path = "ease_out",
    exec_cb = function(o, v) b.w = v o:set { w = v } end })
end

local lastDraw, lastKind = -1e9, nil

function on_tick(ctx, dt_ms)
  local r = ld2410.read()
  local kind = r.moving and "MOVING" or r.still and "PRESENT" or "EMPTY"
  local now = ctx.time_ms
  if paper and kind == lastKind and now - lastDraw < 10000 then return end
  lastDraw = now
  local present = kind ~= "EMPTY"

  if kind ~= lastKind then
    lastKind = kind
    local look, textColor, accent = badgeLook(kind)
    badge:set(look)
    badgeLabel:set { text = kind, text_color = textColor }
    animate("pop", badge, { start_value = 208, end_value = 256, duration = 320, path = "overshoot",
      exec_cb = function(o, v) o:set { transform_scale_x = v, transform_scale_y = v } end })
    if marker then
      marker:set { bg_color = accent }
      animate("fade", marker, { start_value = markerOpa, end_value = present and 255 or 0,
        duration = 180, path = "ease_out", exec_cb = function(o, v) markerOpa = v o:set { opa = v } end })
    end
  end

  text(distance, present and metres(r.distance_cm) or "-- m")
  text(status, r.connected and "UART ok" or "no data")

  if marker and present then
    local tx = gw * math.min(r.distance_cm, MAX_CM) // MAX_CM
    if tx ~= markerTarget then
      markerTarget = tx
      animate("glide", marker, { start_value = markerX, end_value = tx, duration = 250, path = "ease_out",
        exec_cb = function(o, v) markerX = v o:set { translate_x = v } end })
    end
  end

  setBar("move", r.moving_energy)
  setBar("still", r.still_energy)

  if lines then
    history[#history + 1] = present and r.distance_cm or -1
    if #history > HMAX then table.remove(history, 1) end
    drawHistory()
  end
end

function on_event(ctx, e)
  if e.name == "presence" then
    log.info(string.format("presence: moving %s, still %s at %d cm", tostring(e.data.moving), tostring(e.data.still), e.data.distance_cm))
  end
end
