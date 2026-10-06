-- Bench's lvgl module: luavgl's app-facing surface (Resident's prompts/lvgl.md and luavgl's
-- display-bind contract) over a JS widget tree and renderer. Loaded on the first lvgl.bind().
--
-- Like the device, animations and timers are NOT driven by on_tick: LVGL's own timer pump runs
-- every LV_DEF_REFR_PERIOD (33 ms on the reference board) and calls Anim exec_cb / Timer cb from
-- there, so motion is ~30 fps while on_tick stays at 10. Anim values follow lv_anim.c: integer
-- steps, the same path curves, delay, playback, repeat and early_apply.
--
-- Chunk args: P (private bridge into host.ts), M (the module table to fill).

local P, M = ...

local floor, max, min, abs = math.floor, math.max, math.min, math.abs
local type, pairs, setmetatable, rawget, error = type, pairs, setmetatable, rawget, error

-- ── constants ──────────────────────────────────────────────────────────────

local SPEC = 1 << 29 -- LV_COORD_TYPE_SPEC
M.SIZE_CONTENT = SPEC | 2001
M.COORD_MAX = SPEC - 1
M.COORD_MIN = -(SPEC - 1)
M.RADIUS_CIRCLE = 0x7FFF
M.ANIM_REPEAT_INFINITE = 0xFFFF
M.ANIM_PLAYTIME_INFINITE = 0xFFFFFFFF
M.LAYOUT_FLEX = 1
M.LAYOUT_GRID = 2
function M.PCT(n) n = floor(n) if n < 0 then n = 1000 - n end return SPEC | n end
function M.OPA(pct) return floor(max(0, min(100, pct)) * 255 / 100 + 0.5) end

M.ALIGN = {
  DEFAULT = 0, TOP_LEFT = 1, TOP_MID = 2, TOP_RIGHT = 3, BOTTOM_LEFT = 4, BOTTOM_MID = 5,
  BOTTOM_RIGHT = 6, LEFT_MID = 7, RIGHT_MID = 8, CENTER = 9,
  OUT_TOP_LEFT = 10, OUT_TOP_MID = 11, OUT_TOP_RIGHT = 12, OUT_BOTTOM_LEFT = 13,
  OUT_BOTTOM_MID = 14, OUT_BOTTOM_RIGHT = 15, OUT_LEFT_TOP = 16, OUT_LEFT_MID = 17,
  OUT_LEFT_BOTTOM = 18, OUT_RIGHT_TOP = 19, OUT_RIGHT_MID = 20, OUT_RIGHT_BOTTOM = 21,
}
M.EVENT = {
  ALL = 0, PRESSED = 1, PRESSING = 2, PRESS_LOST = 3, SHORT_CLICKED = 4, LONG_PRESSED = 5,
  LONG_PRESSED_REPEAT = 6, CLICKED = 7, RELEASED = 8, SCROLL_BEGIN = 9, SCROLL_END = 10,
  SCROLL = 11, GESTURE = 12, KEY = 13, FOCUSED = 14, DEFOCUSED = 15, LEAVE = 16,
  VALUE_CHANGED = 28, INSERT = 29, REFRESH = 30, READY = 31, CANCEL = 32,
  DELETE = 33, SIZE_CHANGED = 36, STYLE_CHANGED = 37,
}
M.FLAG = {
  HIDDEN = 1 << 0, CLICKABLE = 1 << 1, CLICK_FOCUSABLE = 1 << 2, CHECKABLE = 1 << 3,
  SCROLLABLE = 1 << 4, SCROLL_ELASTIC = 1 << 5, SCROLL_MOMENTUM = 1 << 6, SCROLL_ONE = 1 << 7,
  SCROLL_CHAIN_HOR = 1 << 8, SCROLL_CHAIN_VER = 1 << 9, SCROLL_ON_FOCUS = 1 << 10,
  SCROLL_WITH_ARROW = 1 << 11, SNAPPABLE = 1 << 12, PRESS_LOCK = 1 << 13, EVENT_BUBBLE = 1 << 14,
  GESTURE_BUBBLE = 1 << 15, ADV_HITTEST = 1 << 16, IGNORE_LAYOUT = 1 << 17, FLOATING = 1 << 18,
  OVERFLOW_VISIBLE = 1 << 20,
}
M.STATE = {
  DEFAULT = 0, CHECKED = 0x0001, FOCUSED = 0x0002, FOCUS_KEY = 0x0004, EDITED = 0x0008,
  HOVERED = 0x0010, PRESSED = 0x0020, SCROLLED = 0x0040, DISABLED = 0x0080, ANY = 0xFFFF,
}
M.PART = {
  MAIN = 0, SCROLLBAR = 0x010000, INDICATOR = 0x020000, KNOB = 0x030000, SELECTED = 0x040000,
  ITEMS = 0x050000, CURSOR = 0x060000, ANY = 0x0F0000,
}
M.TEXT_ALIGN = { AUTO = 0, LEFT = 1, CENTER = 2, RIGHT = 3 }
M.FLEX_FLOW = {
  ROW = 0, COLUMN = 1, ROW_WRAP = 4, ROW_REVERSE = 8, ROW_WRAP_REVERSE = 12,
  COLUMN_WRAP = 5, COLUMN_REVERSE = 9, COLUMN_WRAP_REVERSE = 13,
}
M.FLEX_ALIGN = { START = 0, END = 1, CENTER = 2, SPACE_EVENLY = 3, SPACE_AROUND = 4, SPACE_BETWEEN = 5 }
M.DIR = { NONE = 0, LEFT = 1, RIGHT = 2, TOP = 4, BOTTOM = 8, HOR = 3, VER = 12, ALL = 15 }
M.SCROLLBAR_MODE = { OFF = 0, ON = 1, ACTIVE = 2, AUTO = 3 }
M.ROLLER_MODE = { NORMAL = 0, INFINITE = 1 }
M.GRAD_DIR = { NONE = 0, VER = 1, HOR = 2 }
M.SCR_LOAD_ANIM = { NONE = 0, OVER_LEFT = 1, OVER_RIGHT = 2, OVER_TOP = 3, OVER_BOTTOM = 4,
  MOVE_LEFT = 5, MOVE_RIGHT = 6, MOVE_TOP = 7, MOVE_BOTTOM = 8, FADE_IN = 9, FADE_OUT = 10 }
M.KEY = { UP = 17, DOWN = 18, RIGHT = 19, LEFT = 20, ESC = 27, DEL = 127, BACKSPACE = 8,
  ENTER = 10, NEXT = 9, PREV = 11, HOME = 2, END = 3 }
M.ARC_MODE = { NORMAL = 0, SYMMETRICAL = 1, REVERSE = 2 }
-- LV_SYMBOL_*: Font Awesome code points in LVGL's built-in fonts.
local function u(cp) return utf8.char(cp) end
M.SYMBOL = {
  AUDIO = u(0xF001), VIDEO = u(0xF008), LIST = u(0xF00B), OK = u(0xF00C), CLOSE = u(0xF00D),
  POWER = u(0xF011), SETTINGS = u(0xF013), HOME = u(0xF015), DOWNLOAD = u(0xF019),
  DRIVE = u(0xF01C), REFRESH = u(0xF021), MUTE = u(0xF026), VOLUME_MID = u(0xF027),
  VOLUME_MAX = u(0xF028), IMAGE = u(0xF03E), TINT = u(0xF043), PREV = u(0xF048), PLAY = u(0xF04B),
  PAUSE = u(0xF04C), STOP = u(0xF04D), NEXT = u(0xF051), EJECT = u(0xF052), LEFT = u(0xF053),
  RIGHT = u(0xF054), PLUS = u(0xF067), MINUS = u(0xF068), EYE_OPEN = u(0xF06E),
  EYE_CLOSE = u(0xF070), WARNING = u(0xF071), SHUFFLE = u(0xF074), UP = u(0xF077), DOWN = u(0xF078),
  LOOP = u(0xF079), DIRECTORY = u(0xF07B), UPLOAD = u(0xF093), CALL = u(0xF095), CUT = u(0xF0C4),
  COPY = u(0xF0C5), SAVE = u(0xF0C7), BARS = u(0xF0C9), ENVELOPE = u(0xF0E0), CHARGE = u(0xF0E7),
  PASTE = u(0xF0EA), BELL = u(0xF0F3), KEYBOARD = u(0xF11C), GPS = u(0xF124), FILE = u(0xF158),
  WIFI = u(0xF1EB), BATTERY_FULL = u(0xF240), BATTERY_3 = u(0xF241), BATTERY_2 = u(0xF242),
  BATTERY_1 = u(0xF243), BATTERY_EMPTY = u(0xF244), USB = u(0xF287), BLUETOOTH = u(0xF293),
  TRASH = u(0xF2ED), EDIT = u(0xF304), BACKSPACE = u(0xF55A), SD_CARD = u(0xF7C2),
  NEW_LINE = u(0xF8A2), DUMMY = u(0xF8FF), BULLET = u(0x2022),
}

-- ── fonts ──────────────────────────────────────────────────────────────────

-- The reference board compiles in Montserrat at these sizes; Font() snaps to the nearest.
local SIZES = { 8, 14, 16, 20, 24, 28, 32, 36, 40, 48 }
local FONT = {}
FONT.__index = FONT
FONT.__tostring = function(f) return "lv_font: montserrat " .. f.size end
local warnedFamily = {}
function M.Font(name, size, weight)
  size = floor(tonumber(size) or 14)
  local best = SIZES[1]
  for _, s in ipairs(SIZES) do if abs(s - size) < abs(best - size) then best = s end end
  local family = "montserrat"
  for part in tostring(name or "montserrat"):gmatch("[^,]+") do
    local f = part:lower():gsub("^%s+", ""):gsub("%s+$", "")
    if f == "montserrat" or f == "sans" or f == "default" then family = "montserrat" break end
    if not warnedFamily[f] then
      warnedFamily[f] = true
      P.log("warn", "lvgl.Font: this board has no '" .. f .. "' font; using montserrat")
    end
  end
  return setmetatable({ __font = true, family = family, size = best, weight = tonumber(weight) or 500 }, FONT)
end
M.BUILTIN_FONT = {}
for _, s in ipairs(SIZES) do M.BUILTIN_FONT["MONTSERRAT_" .. s] = M.Font("montserrat", s) end

-- ── styles ─────────────────────────────────────────────────────────────────

local STYLE = {}
STYLE.__index = STYLE
-- A Style is shared: objects refer to it by id, so set() reaches every object that added it.
local nextStyle = 0
function STYLE:set(props) for k, v in pairs(props) do self.props[k] = v end P.update_style(self.__sid, self:_plain()) end
function STYLE:remove_prop(k) self.props[k] = nil P.update_style(self.__sid, self:_plain()) end
function STYLE:delete() self.props = {} P.update_style(self.__sid, {}) end
function M.Style(props)
  nextStyle = nextStyle + 1
  local s = setmetatable({ __style = true, __sid = nextStyle, props = {} }, STYLE)
  if props then for k, v in pairs(props) do s.props[k] = v end end
  return s
end

-- Property tables cross into JS as plain data: fonts become {family,size,weight}.
local plain
function STYLE:_plain() return plain(self.props) end
function plain(props)
  local out = {}
  for k, v in pairs(props) do
    if type(v) == "table" and v.__font then out[k] = { family = v.family, size = v.size, weight = v.weight }
    elseif type(v) == "table" and v.__id then out[k] = v.__id
    elseif type(v) ~= "function" then out[k] = v end
  end
  return out
end

-- ── objects ────────────────────────────────────────────────────────────────

local anims = {} -- running animations, in start order
local objects = {} -- id → Lua object (weak would let a running Anim lose its target; keep strong)
local OBJ = {}
OBJ.__index = function(o, k)
  local m = OBJ[k]
  if m then return m end
  local ctor = M._ctors and M._ctors[k]
  if ctor then return function(self, ...) return ctor(self, ...) end end
  return nil
end
OBJ.__tostring = function(o) return "lv_obj: " .. o.__kind .. "#" .. o.__id end

local function alive(o, fname)
  if type(o) ~= "table" or not o.__id then error(fname .. ": expected an lvgl object", 3) end
  if o.__dead then error(fname .. ": object deleted", 3) end
  return o.__id
end

local function wrap(id, kind)
  local o = setmetatable({ __id = id, __kind = kind }, OBJ)
  objects[id] = o
  return o
end

local function kill(ids)
  for _, id in ipairs(ids) do
    local o = objects[id]
    if o then o.__dead = true objects[id] = nil end
  end
end

function OBJ:set(props)
  local id = alive(self, "set")
  if type(props) ~= "table" then error("set: expected a property table", 2) end
  P.set(id, plain(props))
  return self
end
function OBJ:center() P.set(alive(self, "center"), { align = M.ALIGN.CENTER, x = 0, y = 0 }) return self end
function OBJ:align_to(t)
  local id = alive(self, "align_to")
  P.align_to(id, t.base and alive(t.base, "align_to") or nil, t.type or M.ALIGN.CENTER, t.x_ofs or 0, t.y_ofs or 0)
  return self
end
function OBJ:delete()
  if self.__dead then return end
  if self.__screen then error("delete: the screen belongs to the display", 2) end
  kill(P.delete(self.__id))
end
function OBJ:clean() kill(P.clean(alive(self, "clean"))) end
function OBJ:add_flag(f) P.flag(alive(self, "add_flag"), floor(f), true) return self end
function OBJ:clear_flag(f) P.flag(alive(self, "clear_flag"), floor(f), false) return self end
function OBJ:has_flag(f) return P.has_flag(alive(self, "has_flag"), floor(f)) end
function OBJ:add_state(s) P.state(alive(self, "add_state"), floor(s), true) return self end
function OBJ:clear_state(s) P.state(alive(self, "clear_state"), floor(s), false) return self end
function OBJ:has_state(s) return P.has_state(alive(self, "has_state"), floor(s)) end
function OBJ:add_style(style, selector)
  local id = alive(self, "add_style")
  if type(style) ~= "table" or not style.__style then error("add_style: expected an lvgl.Style", 2) end
  self.__styles = self.__styles or {}
  self.__styles[#self.__styles + 1] = style
  P.add_style(id, plain(style.props), floor(selector or 0), style.__sid)
  return self
end
function OBJ:set_style(props, selector)
  local id = alive(self, "set_style")
  if type(props) ~= "table" then error("set_style: expected a property table", 2) end
  P.add_style(id, plain(props), floor(selector or 0))
  return self
end
function OBJ:remove_style(style, selector) P.remove_styles(alive(self, "remove_style")) return self end
function OBJ:set_parent(parent) P.set(alive(self, "set_parent"), { parent = alive(parent, "set_parent") }) return self end
function OBJ:get_child_cnt() return P.child_count(alive(self, "get_child_cnt")) end
function OBJ:set_flex_flow(flow) P.set(alive(self, "set_flex_flow"), { flex_flow = floor(flow) }) return self end
function OBJ:set_flex_align(main, cross, track)
  P.set(alive(self, "set_flex_align"), { flex_main_place = main, flex_cross_place = cross, flex_track_place = track })
  return self
end
function OBJ:set_flex_grow(g) P.set(alive(self, "set_flex_grow"), { flex_grow = g }) return self end
function OBJ:is_visible() return not P.has_flag(alive(self, "is_visible"), M.FLAG.HIDDEN) end
function OBJ:get_state() return P.get_state(alive(self, "get_state")) end
function OBJ:get_pos() local c = P.coords(alive(self, "get_pos")) return c[5], c[6] end
function OBJ:remove_all_anim()
  for _, a in ipairs(anims) do if a.target == self then a:stop() end end
end
function OBJ:remove_style_all() P.remove_styles(alive(self, "remove_style_all")) self.__styles = {} return self end
function OBJ:get_coords()
  local c = P.coords(alive(self, "get_coords"))
  return { x1 = c[1], y1 = c[2], x2 = c[3], y2 = c[4] }
end
function OBJ:get_x() return P.coords(alive(self, "get_x"))[5] end
function OBJ:get_y() return P.coords(alive(self, "get_y"))[6] end
function OBJ:get_width() local c = P.coords(alive(self, "get_width")) return c[3] - c[1] + 1 end
function OBJ:get_height() local c = P.coords(alive(self, "get_height")) return c[4] - c[2] + 1 end
function OBJ:get_parent() local p = P.parent(alive(self, "get_parent")) return p and objects[p] or nil end
function OBJ:invalidate() P.invalidate(alive(self, "invalidate")) end
-- Events are kept, and fired when Bench gets an input device for LVGL; on a board without a
-- touchscreen (the M5Stick) nothing presses LVGL widgets either.
function OBJ:onevent(code, fn) self.__events = self.__events or {} self.__events[code] = fn return self end
function OBJ:onClicked(fn) return self:onevent(M.EVENT.CLICKED, fn) end
function OBJ:onPressed(fn) return self:onevent(M.EVENT.PRESSED, fn) end
function OBJ:onShortClicked(fn) return self:onevent(M.EVENT.SHORT_CLICKED, fn) end
-- Led
function OBJ:on() P.set(alive(self, "on"), { brightness = 255 }) return self end
function OBJ:off() P.set(alive(self, "off"), { brightness = 0 }) return self end
function OBJ:toggle()
  local id = alive(self, "toggle")
  P.set(id, { brightness = (P.get(id, "brightness") or 255) > 127 and 0 or 255 })
  return self
end
-- Roller / Dropdown
function OBJ:get_selected() return P.get(alive(self, "get_selected"), "selected") or 0 end
function OBJ:get_selected_str()
  local id = alive(self, "get_selected_str")
  local opts, sel = P.get(id, "options") or "", P.get(id, "selected") or 0
  local i = 0
  for line in (opts .. "\n"):gmatch("([^\n]*)\n") do
    if i == sel then return line end
    i = i + 1
  end
  return ""
end
function OBJ:open() end
function OBJ:close() end
function OBJ:add_option(s, pos)
  local id = alive(self, "add_option")
  local opts = P.get(id, "options") or ""
  P.set(id, { options = opts == "" and s or (opts .. "\n" .. s) })
end
function OBJ:option_index(s)
  local i = 0
  for line in ((P.get(alive(self, "option_index"), "options") or "") .. "\n"):gmatch("([^\n]*)\n") do
    if line == s then return i end
    i = i + 1
  end
  return -1
end

-- ── animations (lv_anim.c semantics) ───────────────────────────────────────

local RES = 1024
local function bezier3(t, u0, u1, u2, u3)
  local t2, rem = t * t, RES - t
  local rem2 = rem * rem
  return ((rem2 * rem * u0) >> 30) + ((3 * rem2 * t * u1) >> 30) + ((3 * rem * t2 * u2) >> 30) + ((t2 * t * u3) >> 30)
end
-- CSS-style cubic Bézier easing: find t for x, return y (lv_cubic_bezier).
local function cubic(x, x1, y1, x2, y2)
  if x <= 0 then return 0 end
  if x >= 1 then return 1 end
  local function bx(t) return 3 * (1 - t) * (1 - t) * t * x1 + 3 * (1 - t) * t * t * x2 + t * t * t end
  local function by(t) return 3 * (1 - t) * (1 - t) * t * y1 + 3 * (1 - t) * t * t * y2 + t * t * t end
  local lo, hi = 0, 1
  for _ = 1, 24 do
    local mid = (lo + hi) / 2
    if bx(mid) < x then lo = mid else hi = mid end
  end
  return by((lo + hi) / 2)
end
local function lerp(a, t)
  if t >= 1 then return a.end_value end
  return a.start_value + floor((a.end_value - a.start_value) * t)
end
local PATHS = {
  linear = function(a, t) return lerp(a, t) end,
  ease_in = function(a, t) return lerp(a, cubic(t, 0.42, 0, 1, 1)) end,
  ease_out = function(a, t) return lerp(a, cubic(t, 0, 0, 0.58, 1)) end,
  ease_in_out = function(a, t) return lerp(a, cubic(t, 0.42, 0, 0.58, 1)) end,
  overshoot = function(a, t)
    local step = bezier3(floor(t * RES), 0, 1000, 1300, 1024)
    return a.start_value + ((a.end_value - a.start_value) * step) // 1024
  end,
  bounce = function(a, tf)
    local t = floor(tf * RES)
    local diff = a.end_value - a.start_value
    -- C integer division truncates towards zero; Lua's // floors.
    local function cdiv(x, d) local q = x / d return q < 0 and -floor(-q) or floor(q) end
    if t < 408 then t = (t * 2500) // 1024
    elseif t < 614 then t = RES - (t - 408) * 5 diff = cdiv(diff, 20)
    elseif t < 819 then t = (t - 614) * 5 diff = cdiv(diff, 20)
    elseif t < 921 then t = RES - (t - 819) * 10 diff = cdiv(diff, 40)
    else t = (t - 921) * 10 diff = cdiv(diff, 40) end
    t = max(0, min(RES, t))
    local step = bezier3(t, RES, 800, 500, 0)
    return a.end_value - cdiv(step * diff, 1024)
  end,
  step = function(a, t) return t >= 1 and a.end_value or a.start_value end,
}

local ANIM = {}
ANIM.__index = ANIM
ANIM.__tostring = function(a)
  return string.format("anim %s, %d→%d", a.running and "running" or "stopped", a.cfg.start_value, a.cfg.end_value)
end
local ANIM_KEYS = { start_value = 1, end_value = 1, time = 1, duration = 1, delay = 1, repeat_count = 1,
  repeat_delay = 1, early_apply = 1, playback_time = 1, playback_delay = 1, path = 1, exec_cb = 1,
  done_cb = 1, run = 1 }

local function anim_remove(a)
  for i, x in ipairs(anims) do if x == a then table.remove(anims, i) break end end
  a.running = false
end

-- Callbacks run protected, as luavgl's pcall does: an error is logged and the pump carries on.
local function call(fn, ...)
  local ok, err = pcall(fn, ...)
  if not ok then P.log("error", "lvgl callback: " .. tostring(err)) end
end

local function anim_value(a, st)
  local t = st.dur > 0 and min(1, st.act / st.dur) or 1
  return (PATHS[a.cfg.path] or PATHS.linear)(st, t)
end

function ANIM:set(para)
  if self.deleted then error("anim already deleted", 2) end
  if self.running then self:stop() end
  local c = self.cfg
  for k, v in pairs(para) do
    if not ANIM_KEYS[k] then P.log("warn", "lvgl.Anim: unknown parameter '" .. tostring(k) .. "'") end
    local key = k == "time" and "duration" or k
    if key == "early_apply" then v = v and v ~= 0 end
    if key ~= "run" then c[key] = v end
  end
  if para.run then self:start() end
  return self
end

function ANIM:start()
  if self.deleted then error("anim already deleted", 2) end
  if self.running then self:stop() end
  local c = self.cfg
  self.st = {
    start_value = floor(c.start_value or 0), end_value = floor(c.end_value or 0),
    act = -(c.delay or 0), dur = c.duration or 500, playback = false,
    repeats = c.repeat_count or 1, current = nil,
  }
  self.running = true
  anims[#anims + 1] = self
  -- early_apply (on by default): the start value lands now, not after the first period.
  if c.early_apply ~= false then
    self.st.current = self.st.start_value
    if c.exec_cb and not self.target.__dead then call(c.exec_cb, self.target, self.st.start_value) end
  end
  return self
end

function ANIM:stop()
  if not self.running then return end
  anim_remove(self)
  if self.cfg.done_cb then call(self.cfg.done_cb, self, self.target) end
end

function ANIM:delete()
  self:stop()
  self.deleted = true
  self.cfg = { start_value = 0, end_value = 0 }
end

-- One run of LVGL's anim timer: advance every running anim by `elapsed` ms.
local function anim_timer(elapsed)
  local list = {}
  for i, a in ipairs(anims) do list[i] = a end
  for _, a in ipairs(list) do
    if a.running then
      local st, c = a.st, a.cfg
      if a.target.__dead then
        anim_remove(a) -- the target is gone (deleted, or the screen was cleaned)
      else
        st.act = st.act + elapsed
        if st.act >= 0 then
          local v = anim_value(a, st)
          if v ~= st.current then
            st.current = v
            if c.exec_cb then call(c.exec_cb, a.target, v) end
          end
          if st.act >= st.dur then
            if (c.playback_time or 0) > 0 and not st.playback then
              -- Play it back: swap the ends and run for playback_time.
              st.playback = true
              st.start_value, st.end_value = st.end_value, st.start_value
              st.act, st.dur = -(c.playback_delay or 0), c.playback_time
            else
              if st.playback then
                st.playback = false
                st.start_value, st.end_value = st.end_value, st.start_value
                st.dur = c.duration or 500
              end
              if st.repeats ~= M.ANIM_REPEAT_INFINITE then st.repeats = st.repeats - 1 end
              if st.repeats > 0 then
                st.act = -(c.repeat_delay or 0)
              else
                a:stop()
              end
            end
          end
        end
      end
    end
  end
end

local function new_anim(target, para)
  if target == nil then error("anim var must not be nil or none", 3) end
  if type(para) ~= "table" then error("expect anim para table", 3) end
  local a = setmetatable({ target = target, cfg = {}, running = false, deleted = false }, ANIM)
  a:set(para)
  return a
end
M.Anim = function(var, para) return new_anim(var, para) end
function OBJ:Anim(para) alive(self, "Anim") return new_anim(self, para) end

-- ── timers ─────────────────────────────────────────────────────────────────

local timers = {}
local TIMER = {}
TIMER.__index = TIMER
function TIMER:set(para)
  for k, v in pairs(para) do self[k] = v end
  return self
end
function TIMER:pause() self.paused = true return self end
function TIMER:resume() self.paused = false return self end
function TIMER:ready() self.due = true return self end
function TIMER:delete()
  for i, t in ipairs(timers) do if t == self then table.remove(timers, i) break end end
  self.deleted = true
end
function M.Timer(para)
  local t = setmetatable({ period = 500, repeat_count = -1, paused = false, last = P.now() }, TIMER)
  t:set(para or {})
  timers[#timers + 1] = t
  return t
end

local function timer_run(now)
  local list = {}
  for i, t in ipairs(timers) do list[i] = t end
  for _, t in ipairs(list) do
    if not t.deleted and not t.paused and (t.due or now - t.last >= (t.period or 500)) then
      t.due = false
      t.last = now
      if t.cb then call(t.cb, t) end
      if t.repeat_count and t.repeat_count > 0 then
        t.repeat_count = t.repeat_count - 1
        if t.repeat_count == 0 then t:delete() end
      end
    end
  end
end

-- ── the pump: what lv_timer_handler does between ticks ─────────────────────

local lastAnim = nil
-- Called by the host on every pass of its loop. Runs the anim timer and user timers when their
-- period has come round; the host redraws afterwards if anything changed.
function M._pump(now, period)
  if lastAnim == nil then lastAnim = now end
  if now - lastAnim >= period then
    local elapsed = now - lastAnim
    lastAnim = now
    anim_timer(elapsed)
  end
  timer_run(now)
end

-- An app reset (or h.clean on the screen) wipes the tree; anims on dead objects drop themselves.
function M._reset()
  for _, a in ipairs(anims) do a.running = false end
  anims, timers = {}, {}
end

-- ── widgets and the display handle ─────────────────────────────────────────

local KINDS = { "Object", "Label", "Button", "Image", "Line", "Arc", "Led", "Checkbox", "Dropdown",
  "Roller", "Textarea", "Scale", "List", "Keyboard", "Calendar" }

local function is_obj(v) return type(v) == "table" and v.__id ~= nil end

local function make_ctor(kind, handle)
  return function(a, b, c)
    -- h.Label{...}, h:Label{...}, h.Label(parent, {...}), parent:Label{...}
    if a == handle then a, b = b, c end
    local parent, props
    if is_obj(a) then parent, props = a, b
    elseif a == nil then parent, props = nil, b
    else parent, props = nil, a end
    if props ~= nil and type(props) ~= "table" then error(kind .. ": expected a property table", 2) end
    local pid = parent and alive(parent, kind) or nil
    local id = P.create(kind, pid)
    local o = wrap(id, kind)
    if props then P.set(id, plain(props)) end
    return o
  end
end

local handle
function M._bind(name)
  if handle then return handle end
  handle = {}
  M._ctors = {}
  for _, kind in ipairs(KINDS) do
    local ctor = make_ctor(kind, handle)
    handle[kind] = ctor
    M._ctors[kind] = function(parent, props) return ctor(parent, props) end
  end
  local screen = wrap(P.screen(), "Screen")
  screen.__screen = true
  handle.screen = function() return screen end
  handle.clean = function() kill(P.clean(screen.__id)) end
  handle.HOR_RES = function() return P.res()[1] end
  handle.VER_RES = function() return P.res()[2] end
  handle.mirror = function() end
  handle.set_default = function() end
  handle.disp = { get_res = function() local r = P.res() return r[1], r[2] end }
  handle.set_theme = function(self, theme)
    if self ~= handle then theme = self end
    if theme == nil then P.theme(nil) return end
    local t = {}
    for k, v in pairs(theme) do
      t[k] = plain(type(v) == "table" and v.__style and v.props or v)
    end
    P.theme(t)
  end
  setmetatable(handle, { __index = M })
  return handle
end

return M
