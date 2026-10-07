-- Bench's Resident sandbox. Runs once in a fresh Lua 5.4 state, with the full standard library,
-- BEFORE the app: it captures what it needs into locals, installs the Resident modules, then strips
-- the globals the device's sandbox doesn't have. The JS side (src/resident/host.ts) hands in `H`,
-- its bridge, and gets back the dispatch API.
--
-- Fidelity notes: argument checks mimic lauxlib (luaL_checkinteger etc.), including the method-call
-- argument numbering, so an app that would raise on the device raises here with the same message.

local H = __ss_host
local DT_SRC = __ss_datetime_src
local LV_SRC = __ss_lvgl_src
__ss_host, __ss_datetime_src, __ss_lvgl_src = nil, nil, nil

local sethook, getinfo = debug.sethook, debug.getinfo
local load, xpcall, error, type, tostring, tonumber, select, pairs, next =
      load, xpcall, error, type, tostring, tonumber, select, pairs, next
local mtype, tointeger, huge = math.type, math.tointeger, math.huge
local fmt, concat, unpack = string.format, table.concat, table.unpack
local setmetatable, rawget, rawlen = setmetatable, rawget, rawlen

local BUDGET = 2000000

-- ── lauxlib-style argument checks (error level 3 = the app's call site) ─────

local function tname(v, i, n)
  if v == nil and i > n then return "no value" end
  return type(v)
end

-- level 4 = argerr <- ck_* <- module function <- the app; pass 3 when called straight from a module function.
local function argerr(i, fname, msg, level)
  error(fmt("bad argument #%d to '%s' (%s)", i, fname, msg), level or 4)
end

local function ck_int(v, i, fname, n)
  local t = mtype(v)
  if t == "integer" then return v end
  if t == nil and type(v) == "string" then v = tonumber(v); t = mtype(v) end
  if t == "float" then
    local k = tointeger(v)
    if k then return k end
    argerr(i, fname, "number has no integer representation")
  end
  argerr(i, fname, "number expected, got " .. tname(v, i, n))
end

local function ck_num(v, i, fname, n)
  if mtype(v) then return v end
  local x = type(v) == "string" and tonumber(v)
  if x then return x end
  argerr(i, fname, "number expected, got " .. tname(v, i, n))
end

local function ck_str(v, i, fname, n)
  local t = type(v)
  if t == "string" then return v end
  if t == "number" then return tostring(v) end
  argerr(i, fname, "string expected, got " .. tname(v, i, n))
end

-- spec letters: i = integer, n = number, s = string, I = optional integer,
-- t = (int) cast of a number (the m5stick driver's `(int)luaL_checknumber`).
-- `method` = colon-called, so argument numbers shift down by one as lauxlib does.
local function wrap(fname, spec, fn, method)
  local kinds = {}
  for k = 1, #spec do kinds[k] = spec:sub(k, k) end
  local nargs = #kinds
  return function(...)
    local a = { ... }
    local n = select("#", ...)
    local off = method and 1 or 0
    for k = 1, nargs do
      local idx = k + off
      local c, v = kinds[k], a[idx]
      if c == "i" then a[idx] = ck_int(v, k, fname, n - off)
      elseif c == "n" then a[idx] = ck_num(v, k, fname, n - off)
      elseif c == "s" then a[idx] = ck_str(v, k, fname, n - off)
      elseif c == "I" then if v ~= nil then a[idx] = ck_int(v, k, fname, n - off) end
      elseif c == "t" then
        local x = ck_num(v, k, fname, n - off)
        a[idx] = x >= 0 and math.floor(x) or -math.floor(-x)
      end
    end
    return fn(unpack(a, 1 + off, nargs + off))
  end
end

-- ── modules ────────────────────────────────────────────────────────────────

local function fn(name) return H[name] end

-- log
local function tostr(...)
  local n = select("#", ...)
  local parts = {}
  for i = 1, n do parts[i] = tostring((select(i, ...))) end
  return concat(parts, "\t")
end
log = {
  info = function(...) H.log("info", tostr(...)) end,
  warn = function(...) H.log("warn", tostr(...)) end,
  error = function(...) H.log("error", tostr(...)) end,
}
print = log.info

-- lgfx (LovyanGFX bindings, ResidentLgfxModule.h)
lgfx = {
  TL_DATUM = 0, TC_DATUM = 1, TR_DATUM = 2,
  ML_DATUM = 4, MC_DATUM = 5, MR_DATUM = 6,
  BL_DATUM = 8, BC_DATUM = 9, BR_DATUM = 10,
  L_BASELINE = 16, C_BASELINE = 17, R_BASELINE = 18,
}
local LGFX = {
  fillScreen = "i", drawPixel = "iii", drawLine = "iiiii",
  drawRect = "iiiii", fillRect = "iiiii",
  drawRoundRect = "iiiiii", fillRoundRect = "iiiiii",
  drawCircle = "iiii", fillCircle = "iiii",
  drawTriangle = "iiiiiii", fillTriangle = "iiiiiii",
  setTextColor = "iI", setTextSize = "n", setTextDatum = "i", setCursor = "ii",
  print = "s", drawString = "sii", width = "", height = "", flip = "",
}
function lgfx.bind(name)
  name = ck_str(name, 1, "bind", select("#", name))
  if not H.lgfx_bind(name) then error(fmt("lgfx.bind: no display named '%s'", name), 2) end
  local g = {}
  for m, spec in pairs(LGFX) do g[m] = wrap(m, spec, fn("lg_" .. m), true) end
  return g
end

-- lvgl (Resident's optional module): `lvgl` is Resident's table (just `bind`) whose missing keys
-- fall through to luavgl's module once the first bind has loaded it, so lvgl.Font / lvgl.Anim /
-- lvgl.ALIGN are nil before then, as on the device. Binding claims the panel from lgfx.
local LVM = nil
local LVP = setmetatable({
  log = function(level, text) H.log(level, text) end,
}, { __index = function(_, k) return H["lv_" .. k] end })
lvgl = setmetatable({
  bind = function(name)
    name = ck_str(name, 1, "bind", select("#", name))
    if not H.lv_claim(name) then error(fmt("lvgl.bind: no display named '%s'", name), 2) end
    if not LVM then
      LVM = {}
      assert(load(LV_SRC, "=lvgl", "t"))(LVP, LVM)
    end
    return LVM._bind(name)
  end,
}, { __index = function(_, k) if LVM then return LVM[k] end return nil end })

-- screen (the M5StickC Plus2 board's DisplayDriver: legacy verbs, 0..255 channels)
local sc_clear = wrap("clear", "III", fn("sc_clear"))
local sc_text = wrap("text", "ttsIIII", fn("sc_text"))
local sc_qr = wrap("qr", "ttsIIII", fn("sc_qr"))
local function d(v, dflt) if v == nil then return dflt end return v end
screen = {
  clear = function(r, g, b) return sc_clear(d(r, 0), d(g, 0), d(b, 0)) end,
  text = function(x, y, s, size, r, g, b) return sc_text(x, y, s, d(size, 2), d(r, 255), d(g, 255), d(b, 255)) end,
  fill_rect = wrap("fill_rect", "ttttttt", fn("sc_fill_rect")),
  rect = wrap("rect", "ttttttt", fn("sc_rect")),
  line = wrap("line", "ttttttt", fn("sc_line")),
  triangle = wrap("triangle", "ttttttttt", fn("sc_triangle")),
  fill_triangle = wrap("fill_triangle", "ttttttttt", fn("sc_fill_triangle")),
  pixel = wrap("pixel", "ttttt", fn("sc_pixel")),
  qr = function(x, y, s, scale, r, g, b) return sc_qr(x, y, s, d(scale, 4), d(r, 0), d(g, 0), d(b, 0)) end,
  flip = function() H.flip("screen") end,
  set_brightness = wrap("set_brightness", "t", fn("sc_set_brightness")),
  width = function() return H.sc_width() end,
  height = function() return H.sc_height() end,
}

-- imu, buzzer, button (the M5StickC Plus2 board's drivers)
imu = {
  accel = function() local v = H.imu_accel() return v[1], v[2], v[3] end,
  gyro = function() local v = H.imu_gyro() return v[1], v[2], v[3] end,
  temp = function() return 0 end,
}
buzzer = {
  beep = wrap("beep", "ii", fn("bz_beep")),
  tone = wrap("tone", "i", fn("bz_tone")),
  stop = function() H.bz_stop() end,
}
button = {
  press_count = function() return H.btn_press_count() end,
}

-- dial, trigger, ld2410: Bench's drivers for the hardware on the desk. Declaring one puts the
-- part on the desk; which hardware drives a dial or trigger is the user's choice (Controls).
-- An optional options table, checked from the module function itself (so errors point at the app).
local function opts_arg(v, i, fname)
  if v == nil then return {} end
  if type(v) ~= "table" then argerr(i, fname, "table expected, got " .. type(v), 4) end
  return v
end

local DIAL = {}
DIAL.__index = DIAL
function DIAL:value() return H.dial_value(self.name) end
function DIAL:delta() return H.dial_delta(self.name) end
function DIAL:fraction() return H.dial_fraction(self.name) end
dial = {
  new = function(name, opts)
    name = ck_str(name, 1, "new", select("#", name, opts))
    local err = H.dial_new(name, opts_arg(opts, 2, "new"))
    if err then error(err, 2) end
    return setmetatable({ name = name }, DIAL)
  end,
}

local TRIGGER = {}
TRIGGER.__index = TRIGGER
function TRIGGER:is_pressed() return H.trig_is_pressed(self.name) end
function TRIGGER:was_pressed() return H.trig_was_pressed(self.name) end
function TRIGGER:was_released() return H.trig_was_released(self.name) end
function TRIGGER:pressed_for(ms) return H.trig_pressed_for(self.name, ck_num(ms, 1, "pressed_for", select("#", ms))) end
trigger = {
  new = function(name, opts)
    name = ck_str(name, 1, "new", select("#", name, opts))
    local err = H.trig_new(name, opts_arg(opts, 2, "new"))
    if err then error(err, 2) end
    return setmetatable({ name = name }, TRIGGER)
  end,
}

ld2410 = {
  begin = function(opts)
    local err = H.ld_begin(opts_arg(opts, 1, "begin"))
    if err then error(err, 2) end
  end,
  read = function()
    local r = H.ld_read()
    if not r then error("ld2410.read: call ld2410.begin() first", 2) end
    return r
  end,
}

-- light, pir, climate, touch: Bench drivers for the sensors on the desk. The first read puts the
-- part on the bench if it isn't there. PIR and touch also send `motion` / `touch` driver events.
local function sensor(kind)
  return function()
    local r = H.sensor_read(kind)
    if r == nil then error(kind .. ": this board has no " .. kind .. " driver", 3) end
    return r
  end
end
light = { read = sensor("light") }
function light.level() return light.read().level end
pir = { read = sensor("pir") }
function pir.motion() return pir.read().motion end
climate = { read = sensor("climate") }
function climate.temperature() return climate.read().temperature end
function climate.humidity() return climate.read().humidity end
touch = { read = sensor("touch") }
function touch.touched() return touch.read().touched end

-- screens
local SCREEN_KEYS = { name = 1, w = 1, h = 1, shape = 1, depth = 1, scheme = 1, dpi = 1, group = 1 }
screens = {
  list = function() return H.screens_list() end,
  get = function(name)
    name = ck_str(name, 1, "get", select("#", name))
    local info = H.screens_get(name)
    return info
  end,
  set = function(name, settings)
    name = ck_str(name, 1, "set", 2)
    if type(settings) ~= "table" then argerr(2, "set", "table expected, got " .. type(settings), 3) end
    local err = H.screens_set(name, settings)
    if err then error(err, 2) end
  end,
  refresh = function(name)
    name = ck_str(name, 1, "refresh", select("#", name))
    return H.screens_refresh(name)
  end,
}

-- events: Resident's serialisation rules (depth 3 counting `data`, arrays when #t > 0)
local ESC = { ['"'] = '\\"', ['\\'] = '\\\\', ['\n'] = '\\n', ['\r'] = '\\r', ['\t'] = '\\t' }
local function esc(s)
  return (s:gsub('[%c"\\]', function(c) return ESC[c] or fmt("\\u%04x", c:byte()) end))
end
local function enc(v, level)
  local t = type(v)
  if t == "string" then return '"' .. esc(v) .. '"' end
  if t == "boolean" then return v and "true" or "false" end
  if t == "number" then
    if mtype(v) == "integer" then return tostring(v) end
    if v ~= v or v == huge or v == -huge then return "null" end
    return fmt("%.7g", v)
  end
  if t ~= "table" or level > 3 then return nil end
  local parts, n = {}, rawlen(v)
  if n > 0 then
    for i = 1, n do parts[i] = enc(v[i], level + 1) or "null" end
    return "[" .. concat(parts, ",") .. "]"
  end
  for k, val in next, v do
    if type(k) == "string" then
      local e = enc(val, level + 1)
      if e then parts[#parts + 1] = '"' .. esc(k) .. '":' .. e end
    end
  end
  return "{" .. concat(parts, ",") .. "}"
end
events = {
  send = function(name, data, opts)
    name = ck_str(name, 1, "send", select("#", name, data, opts))
    local json = "{}"
    if data ~= nil then
      if type(data) ~= "table" then argerr(2, "send", "table expected, got " .. type(data), 3) end
      json = enc(data, 1)
    end
    return H.events_send(name, json, type(opts) == "table" and opts.keep == true)
  end,
}

-- store
local function scalar(v) local t = type(v) return t == "string" or t == "number" or t == "boolean" end
store = {
  get = function(key) local v = H.store_get(ck_str(key, 1, "get", select("#", key))) return v end,
  set = function(key, value)
    key = ck_str(key, 1, "set", 2)
    if value ~= nil and not scalar(value) then return false end
    return H.store_set(key, value)
  end,
  keys = function() return H.store_keys() end,
  clear = function() H.store_clear() end,
  remaining = function() return H.store_remaining() end,
}

-- time: a wrapping int32 millisecond counter, plus the deprecated calendar half
local function i32(x) x = x % 4294967296 if x >= 2147483648 then x = x - 4294967296 end return x end
local warned = {}
local DEPRECATED = {
  time = "datetime.now():timestamp()",
  gmtime = "datetime.now(datetime.UTC) / datetime.fromtimestamp(secs, datetime.UTC)",
  localtime = "datetime.now() / datetime.fromtimestamp(secs)",
  mktime = "datetime(y, m, d, ...):timestamp()",
  strftime = "dt:strftime(fmt)",
  synced = "datetime.synced()",
}
local function deprecated(name)
  if warned[name] then return end
  warned[name] = true
  H.log("warn", fmt("[deprecated] time.%s(): use %s", name, DEPRECATED[name]))
end
local function opt_secs(v, fname)
  if v == nil then return H.dt_now() end
  return math.floor(ck_num(v, 1, fname, 1))
end
time = {
  ticks_ms = function() return i32(H.millis()) end,
  ticks_diff = function(a, b) return i32(ck_int(a, 1, "ticks_diff", 2) - ck_int(b, 2, "ticks_diff", 2)) end,
  time = function() deprecated("time") return H.dt_now() end,
  gmtime = function(s) deprecated("gmtime") return H.tm_struct(opt_secs(s, "gmtime"), false) end,
  localtime = function(s) deprecated("localtime") return H.tm_struct(opt_secs(s, "localtime"), true) end,
  mktime = function(t)
    deprecated("mktime")
    if type(t) ~= "table" then argerr(1, "mktime", "table expected, got " .. type(t), 3) end
    return H.tm_mktime(t)
  end,
  strftime = function(f, t)
    deprecated("strftime")
    f = ck_str(f, 1, "strftime", 2)
    return H.tm_strftime(f, t)
  end,
  synced = function() deprecated("synced") return true end,
}

-- datetime: Resident's own Lua module over JS primitives, loaded on first touch
local function raise_in_app(msg)
  local level = 2
  while true do
    local ar = getinfo(level, "Sl")
    if not ar then error(msg, 0) end
    if ar.currentline > 0 and ar.source ~= "=datetime" then
      error(ar.short_src .. ":" .. ar.currentline .. ": " .. msg, 0)
    end
    level = level + 1
  end
end
local EPOCH_RANGE = "datetime: outside 1901-12-13..2038-01-19, the reach of 32-bit epoch seconds"
local function epoch(v) if v == nil then raise_in_app(EPOCH_RANGE) end return v end
local P = {
  now = function() return epoch(H.dt_now32()) end,
  split = function(secs, isLocal) local r = H.dt_split(secs, isLocal and true or false) return r[1], r[2], r[3], r[4], r[5], r[6] end,
  epoch = function(...) return epoch(H.dt_epoch(...)) end,
  resolve = function(...)
    local r = H.dt_resolve(...)
    if not r then raise_in_app(EPOCH_RANGE) end
    return r[1], r[2], r[3]
  end,
  ord = function(y, m, d) return H.dt_ord(y, m, d) end,
  civil = function(n) local r = H.dt_civil(n) return r[1], r[2], r[3] end,
  strftime = function(...) return H.dt_strftime(...) end,
  mul = function(d, s, n)
    local r = H.dt_mul(d, s, n)
    if not r then raise_in_app("datetime.timedelta: out of range") end
    return r[1], r[2]
  end,
  synced = function() return true end,
  raise = raise_in_app,
}
local function load_datetime(M)
  setmetatable(M, nil)
  local chunk = assert(load(DT_SRC, "=datetime", "t"))
  chunk(P, M)
end
datetime = setmetatable({}, {
  __index = function(t, k) load_datetime(t) return rawget(t, k) end,
  __call = function(t, ...) load_datetime(t) return t(...) end,
})

-- ── the sandbox boundary ───────────────────────────────────────────────────

for _, k in ipairs({ "os", "io", "require", "load", "loadfile", "dofile", "debug", "package" }) do _G[k] = nil end

local function budget_hook()
  error("instruction budget exceeded: 2,000,000 per callback", 2)
end
local function handler(e) return tostring(e) end
local function run(f, ...)
  sethook(budget_hook, "", BUDGET)
  local ok, err = xpcall(f, handler, ...)
  sethook()
  return ok, err
end

local ctx = { time_ms = 0 }
local api = {}

-- Returns nil on success, else the error message.
function api.load(code, generation)
  local f, err = load(code, "=app", "t")
  if not f then return err end
  ctx.generation_id = generation
  local ok, e = run(f)
  if not ok then return e end
  if type(rawget(_G, "init")) ~= "function" and type(rawget(_G, "on_tick")) ~= "function"
     and type(rawget(_G, "on_event")) ~= "function" then
    return "app rejected: define at least one of init, on_tick, on_event"
  end
  return nil
end

function api.chunk(code)
  local f, err = load(code, "=chunk", "t")
  if not f then return err end
  local ok, e = run(f)
  if not ok then return e end
  return nil
end

function api.has(name) return type(rawget(_G, name)) == "function" end

-- LVGL's timer pump, called on every pass of the host loop (not on_tick's 10 Hz).
function api.lv_pump(time_ms, period)
  if not LVM then return nil end
  ctx.time_ms = time_ms
  local ok, err = run(LVM._pump, time_ms, period)
  if ok then return nil end
  return err
end

function api.call(name, time_ms, arg)
  local f = rawget(_G, name)
  if type(f) ~= "function" then return nil end
  ctx.time_ms = time_ms
  if name == "on_event" then
    local e = { name = arg.name, from = arg.from or "", ts_ms = arg.ts_ms, channel = arg.channel,
                src = arg.src, seq = arg.seq, data = arg.data or {} }
    if arg.channel == "driver" then
      -- deprecated shadow: driver events mirror top-level scalars onto the event
      for k, v in pairs(e.data) do if e[k] == nil and type(v) ~= "table" then e[k] = v end end
    end
    arg = e
  end
  local ok, err = run(f, ctx, arg)
  if ok then return nil end
  return err
end

return api
