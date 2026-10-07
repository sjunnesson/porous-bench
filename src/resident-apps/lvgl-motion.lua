-- LVGL motion: lvgl.Anim vs on_tick, side by side. Anims run on LVGL's own timer pump (~30 fps here), on_tick only at 10 Hz.
-- @needs motion 128x128
local h = lvgl.bind("main")
local W, H = h.HOR_RES(), h.VER_RES()
local s = screens.get("main")
-- Round glass (shape "round"): lay everything out in the square inside the circle.
local ui = h
if s.shape == "round" then
  local side = math.floor(math.min(W, H) * 0.7071)
  local box = h.Object { x = (W - side) // 2, y = (H - side) // 2, w = side, h = side,
    bg_opa = 0, border_width = 0, pad_all = 0, radius = 0 }
  ui = setmetatable({}, { __index = function(_, kind) return function(props) return box[kind](box, props) end end })
  W, H = side, side
end
local small = H < 160

h:set_theme {
  screen = { bg_color = "#101018" },
  object = { bg_opa = 0, border_width = 0, pad_all = 0, radius = 0 },
  label = { text_color = "#ececf2", text_font = lvgl.Font("montserrat", small and 14 or 16) },
}

-- Two lanes: the top dot is moved by an Anim, the bottom one by on_tick. Same easing, same period.
local laneW = W - 24
local trackY1 = small and 30 or 54
local trackY2 = trackY1 + (small and 34 or 46)
local DOT = small and 12 or 16
local PERIOD = 1400 -- ms, there and back

local function lane(y, caption, color)
  ui.Label { text = caption, x = 12, y = y - (small and 18 or 22), text_color = "#8a8aa6",
    text_font = lvgl.Font("montserrat", small and 8 or 14) }
  ui.Object { x = 12, y = y + DOT // 2 - 2, w = laneW, h = 4, bg_color = "#2a2a3a", bg_opa = 255, radius = 2 }
  return ui.Object { x = 12, y = y, w = DOT, h = DOT, bg_color = color, bg_opa = 255, radius = lvgl.RADIUS_CIRCLE }
end

local animDot = lane(trackY1, "lvgl.Anim  ~30 fps", "#5ac8fa")
local tickDot = lane(trackY2, "on_tick  10 Hz", "#ff9f43")

-- The Anim: LVGL interpolates and calls exec_cb from its pump, between ticks.
animDot:Anim {
  start_value = 0, end_value = laneW - DOT,
  duration = PERIOD // 2, playback_time = PERIOD // 2,
  path = "ease_in_out",
  repeat_count = lvgl.ANIM_REPEAT_INFINITE,
  exec_cb = function(obj, v) obj:set { translate_x = v } end,
  run = true,
}

-- The same motion done "by hand" in on_tick: a smoothstep there and back, 10 steps a second.
local function ease(t) return t * t * (3 - 2 * t) end
function on_tick(ctx)
  local phase = (ctx.time_ms % PERIOD) / (PERIOD / 2)
  local t = phase <= 1 and phase or 2 - phase
  tickDot:set { translate_x = math.floor(ease(t) * (laneW - DOT)) }
end

-- A spinner and a pulsing LED, both Anims.
local arcSize = small and 40 or 64
local arc = ui.Arc {
  w = arcSize, h = arcSize, align = lvgl.ALIGN.BOTTOM_LEFT, x = 12, y = -8,
  arc_width = small and 5 or 8, value = 0,
  bg_start_angle = 0, bg_end_angle = 360, rotation = 270,
}
arc:set_style({ arc_color = "#2a2a3a" }, lvgl.PART.MAIN)       -- the track
arc:set_style({ arc_color = "#5ac8fa" }, lvgl.PART.INDICATOR)  -- the moving part
arc:set_style({ bg_opa = 0 }, lvgl.PART.KNOB)                   -- no knob on a spinner
arc:Anim {
  start_value = 0, end_value = 100, duration = 900, playback_time = 900,
  path = "ease_in_out", repeat_count = lvgl.ANIM_REPEAT_INFINITE,
  exec_cb = function(obj, v) obj:set { value = v } end, run = true,
}

local led = ui.Led { w = small and 14 or 20, h = small and 14 or 20, color = "#ff5e7e",
  align = lvgl.ALIGN.BOTTOM_LEFT, x = 12 + arcSize + 18, y = -(arcSize // 2) }
led:Anim {
  start_value = 40, end_value = 255, duration = 700, playback_time = 700,
  path = "ease_in_out", repeat_count = lvgl.ANIM_REPEAT_INFINITE,
  exec_cb = function(obj, v) obj:set { brightness = v } end, run = true,
}

-- A label that bounces in once, then a counter on_tick updates (state, not motion: that's fine).
local count = ui.Label { text = "0", align = lvgl.ALIGN.BOTTOM_RIGHT, x = -12, y = -8,
  text_font = lvgl.Font("montserrat", small and 24 or 32) }
count:Anim {
  start_value = -40, end_value = 0, duration = 900, path = "bounce",
  exec_cb = function(obj, v) obj:set { translate_y = v } end, run = true,
}
local ticks = 0
local function bump()
  ticks = ticks + 1
  count:set { text = tostring(ticks // 10) }
end
local prev = on_tick
function on_tick(ctx, dt) prev(ctx, dt) bump() end
