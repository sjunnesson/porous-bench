-- porous.systems Bench remote: this app's inputs come from Bench (bench.porous.systems), which sends
-- their state over the relay as "bench" events. Bench's drivers (dial, trigger, light, pir,
-- climate, touch, ld2410, imu, and a silent buzzer) are defined here only where this firmware has
-- none. Each sits between "@@part <module> [<module> …]" and "@@end" lines: Bench sends only the
-- parts the app names, since every line here costs compile memory on the device. Bench's buttons A and B arrive
-- as the taps and holds Bench recognised, and touches on Bench's screen as touch_* events. The
-- board's own keys and touch panel still reach the app: a press on the real board always counts.
local __bench = { d = {}, t = {}, s = {}, g = {}, taps = 0 }
local __now = function() return (time and time.ticks_ms) and time.ticks_ms() or 0 end

-- @@part dial
if not dial then
  local D = {}
  D.__index = D
  local function get(self) return __bench.d[self.name] end
  function D:value() local v = get(self) return v and v[1] or self.start end
  function D:fraction() local v = get(self) return v and v[2] or 0 end
  -- Steps since the last call: Bench sends a running total of steps.
  function D:delta()
    local v = get(self)
    if not v then return 0 end
    local d = v[3] - (self.steps or v[3])
    self.steps = v[3]
    return d
  end
  dial = {
    new = function(name, opts)
      opts = opts or {}
      return setmetatable({ name = name, start = opts.start or opts.min or 0 }, D)
    end,
  }
end
-- @@end

-- @@part trigger
if not trigger then
  local T = {}
  T.__index = T
  local function get(self) return __bench.t[self.name] end
  function T:is_pressed() local v = get(self) return v ~= nil and v[3] == 1 end
  -- Bench sends press and release counts, so a press between two updates is never lost.
  function T:was_pressed()
    local v = get(self)
    if not v then return false end
    local fired = self.p ~= nil and v[1] > self.p
    self.p = v[1]
    return fired
  end
  function T:was_released()
    local v = get(self)
    if not v then return false end
    local fired = self.r ~= nil and v[2] > self.r
    self.r = v[2]
    return fired
  end
  function T:pressed_for(ms)
    local v = get(self)
    return v ~= nil and v[3] == 1 and __bench.since[self.name] ~= nil and __now() - __bench.since[self.name] >= ms
  end
  -- v[4..] are the codes of the presses the board hasn't had, the last for the newest.
  function T:code()
    local v = get(self)
    local c = v and #v > 3 and v[#v]
    if c and c ~= "" then return c end
  end
  trigger = {
    new = function(name)
      local v = __bench.t[name]
      return setmetatable({ name = name, p = v and v[1], r = v and v[2] }, T)
    end,
  }
end
-- @@end
__bench.since = {}

-- Taps on Bench's buttons and on the board's own keys, counted together (see on_event below).
if button then pcall(function() button.press_count = function() return __bench.taps end end) end

local function sensor(key, default)
  return function() return __bench.s[key] or default end
end
-- @@part thermal pulse
-- Arrays Bench packs two characters a number (base64url, 12 bits): lo + n * step each.
local __b64 = {}
for i = 1, 64 do __b64[("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"):byte(i)] = i - 1 end
local function __unpack(s, lo, step)
  local out = {}
  for i = 1, #s - 1, 2 do
    local v = lo + (__b64[s:byte(i)] * 64 + __b64[s:byte(i + 1)]) * step
    out[#out + 1] = math.tointeger(v) or v -- 22, not 22.0, as Bench gives it
  end
  return out
end
-- @@end
-- @@part light
if not light then
  light = { read = sensor("light", { level = 0.5, lux = 300, raw = 2048 }) }
  function light.level() return light.read().level end
end
-- @@end
-- @@part pir
if not pir then
  pir = { read = sensor("pir", { motion = false }) }
  function pir.motion() return pir.read().motion end
end
-- @@end
-- @@part climate
if not climate then
  climate = { read = sensor("climate", { temperature = 21, humidity = 40 }) }
  function climate.temperature() return climate.read().temperature end
  function climate.humidity() return climate.read().humidity end
end
-- @@end
-- @@part pulse
if not pulse then
  local seen
  pulse = { read = sensor("pulse", { finger = false, ir = 0, red = 0 }) }
  function pulse.bpm() return pulse.read().bpm end
  -- The samples Bench sent that this app hasn't had: each update carries the newest, numbered.
  function pulse.samples()
    local r, out = pulse.read(), {}
    if r.w then
      local w = __unpack(r.w, r.b, r.st or 4)
      for i, v in ipairs(w) do
        if seen == nil or r.n - #w + i > seen then out[#out + 1] = v end
      end
      seen = r.n
    end
    return out
  end
end
-- @@end
-- @@part co2
if not co2 then
  co2 = { read = sensor("co2", {}) }
  function co2.ppm() return co2.read().co2 end
end
-- @@end
-- @@part touch
if not touch then
  touch = { read = sensor("touch", { touched = false, raw = 0 }) }
  function touch.touched() return touch.read().touched end
end
-- @@end
-- @@part keypad
if not keypad then
  keypad = { read = sensor("keypad", { keys = {}, mask = 0 }) }
  function keypad.pressed(key)
    for _, k in ipairs(keypad.read().keys) do if k == key then return true end end
    return false
  end
end
-- @@end
-- @@part rfid
if not rfid then
  rfid = { read = sensor("rfid", { present = false }) }
  function rfid.uid() return rfid.read().uid end
end
-- @@end
-- @@part ir
if not ir then
  ir = { read = sensor("ir", { address = 0 }) }
  function ir.key() return ir.read().key end
end
-- @@end
-- @@part mic
if not mic then
  mic = { read = sensor("mic", { level = 0.14, db = 40, bands = { 0, 0, 0, 0, 0, 0, 0, 0 } }) }
  function mic.level() return mic.read().level end
  function mic.db() return mic.read().db end
end
-- @@end
-- @@part switch
if not switch then
  switch = { read = sensor("switch", { on = false }) }
  function switch.on() return switch.read().on end
end
-- @@end
-- @@part joystick
if not joystick then
  joystick = { read = sensor("joystick", { x = 0, y = 0, pressed = false, raw_x = 2026, raw_y = 2026 }) }
  function joystick.x() return joystick.read().x end
  function joystick.y() return joystick.read().y end
  function joystick.pressed() return joystick.read().pressed end
end
-- @@end
-- @@part thermal
if not thermal then
  local packed, pixels = nil, {}
  for i = 1, 64 do pixels[i] = 22 end -- a room, until Bench's first frame
  thermal = {
    read = function()
      local r = __bench.s.thermal or { thermistor = 22, max = 22, warm = false, hot_x = 3.5, hot_y = 3.5 }
      if r.p and r.p ~= packed then packed, pixels = r.p, __unpack(r.p, -20, 0.25) end
      r.pixels = table.move(pixels, 1, 64, 1, {}) -- the app's own copy, as Bench gives it
      return r
    end,
  }
  function thermal.pixels() return thermal.read().pixels end
end
-- @@end
-- @@part tof
if not tof then
  tof = { read = sensor("tof", { status = "out of range" }) }
  function tof.mm() return tof.read().mm end
end
-- @@end
-- @@part ld2410
if not ld2410 then
  ld2410 = {
    begin = function() end,
    read = sensor("radar", { connected = true, moving = false, still = false, distance_cm = 0, moving_cm = 0,
      moving_energy = 0, still_cm = 0, still_energy = 0, out = false }),
  }
end
-- @@end
-- @@part imu
if not imu then
  imu = {
    accel = function() local a = __bench.s.imu or { 0, 0, 1 } return a[1], a[2], a[3] end,
    gyro = function() local a = __bench.s.imu or {} return a[4] or 0, a[5] or 0, a[6] or 0 end,
    temp = function() return 0 end,
  }
end
-- @@end
-- @@part touchscreen
if not touchscreen then
  touchscreen = { read = function() return __bench.touch or { pressed = false, x = 0, y = 0 } end }
  function touchscreen.pressed() return touchscreen.read().pressed end
end
-- @@end
-- @@part buzzer
if not buzzer then
  buzzer = { beep = function() end, tone = function() end, stop = function() end }
end
-- @@end

-- Apply one update from Bench, and raise the driver events the app would get on Bench itself.
local function __bench_apply(ctx, data, deliver)
  for name, v in pairs(data.d or {}) do
    local was = __bench.d[name]
    __bench.d[name] = v
    if was and was[1] ~= v[1] then deliver(ctx, "dial", { name = name, value = v[1], delta = v[3] - was[3] }) end
  end
-- @@part trigger
  for name, v in pairs(data.t or {}) do
    local was = __bench.t[name]
    __bench.t[name] = v
    if v[3] == 1 and not (was and was[3] == 1) then __bench.since[name] = __now() end
    if was then
      -- Each edge in the order it came (presses and releases take turns), each press with its own code.
      local p, r = was[1], was[2]
      while p < v[1] or r < v[2] do
        if r < v[2] and (r < p or p >= v[1]) then
          r = r + 1
          deliver(ctx, "trigger", { name = name, pressed = false })
        else
          p = p + 1
          local i = p - v[1] + #v
          local c = i > 3 and v[i] or ""
          deliver(ctx, "trigger", { name = name, pressed = true, code = c ~= "" and c or nil })
        end
      end
    end
  end
-- @@end
  -- Bench's buttons A and B: the taps and holds Bench recognised, replayed as they are, so both
  -- screens see the same gestures.
  for i, v in ipairs(data.g or {}) do
    local was = __bench.g[i]
    __bench.g[i] = v
    if was then
      local index = i - 1
      for _ = was[2] + 1, v[2] do deliver(ctx, "hold", { index = index, held = true }) end
      for _ = was[1] + 1, v[1] do
        __bench.taps = __bench.taps + 1
        deliver(ctx, "tap", { index = index, count = __bench.taps })
        deliver(ctx, "button", { index = index, count = __bench.taps })
      end
      for _ = was[3] + 1, v[3] do deliver(ctx, "hold", { index = index, held = false }) end
    end
  end
  -- Touches on Bench's screen, in order, with their points.
  local TOUCH = { d = "touch_down", m = "touch_move", u = "touch_up", t = "touch_tap" }
  local te = data.te or {}
  if __bench.te_seq == nil then
    __bench.te_seq = #te > 0 and te[#te][1] or 0 -- the first update is a baseline
  else
    for _, ev in ipairs(te) do
      if ev[1] > __bench.te_seq then
        __bench.te_seq = ev[1]
        __bench.touch = { pressed = ev[2] == "d" or ev[2] == "m", x = ev[3], y = ev[4] }
        deliver(ctx, TOUCH[ev[2]], { x = ev[3], y = ev[4] })
      end
    end
  end
  local s = data.s or {}
  local before = __bench.s
  -- A reading an update left out (to stay under the relay's size limit) keeps its last value.
  for k, v in pairs(before) do if s[k] == nil then s[k] = v end end
  __bench.s = s
-- @@part on_event
  -- The sensors' driver events as Bench raised them, in order: [seq, name, data]. Sent to every app
  -- that takes events: one can handle "key" through a table of handlers without naming it.
  local ev = data.ev or {}
  if __bench.ev_seq == nil then
    __bench.ev_seq = #ev > 0 and ev[#ev][1] or 0 -- the first update is a baseline
  else
    for _, e in ipairs(ev) do
      if e[1] > __bench.ev_seq then
        __bench.ev_seq = e[1]
        deliver(ctx, e[2], e[3])
      end
    end
  end
-- @@end
  -- The radar's changes only: its first reading is where it starts, not an event.
-- @@part ld2410
  local r, was = s.radar, before.radar
  if r and was and (r.moving ~= was.moving or r.still ~= was.still) then
    deliver(ctx, "presence", { moving = r.moving, still = r.still, distance_cm = r.distance_cm })
  end
-- @@end
end

-- @@APP@@

-- porous.systems Bench remote: Bench's updates are handled here; every other event goes to the app.
do
  local app_on_event = on_event
  local function deliver(ctx, name, data)
    if app_on_event then app_on_event(ctx, { name = name, data = data, channel = "driver" }) end
  end
  function on_event(ctx, e)
    if e.name == "bench" and e.channel == "app" then
      __bench_apply(ctx, e.data or {}, deliver)
      return
    end
    -- The board's own keys reach the app too, counted with Bench's taps (tap comes before button).
    if (e.name == "tap" or e.name == "button") and e.channel ~= "app" and e.data then
      if e.name == "tap" then __bench.taps = __bench.taps + 1 end
      e.data.count = __bench.taps
    end
    if app_on_event then return app_on_event(ctx, e) end
  end
end
