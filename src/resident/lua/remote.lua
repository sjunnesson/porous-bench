-- porous.systems Bench remote: this app's inputs come from Bench (bench.porous.systems), which sends
-- their state over the relay as "bench" events. Bench's drivers (dial, trigger, light, pir,
-- climate, touch, ld2410, imu) are defined here only where this firmware has none.
local __bench = { d = {}, t = {}, s = {} }
local __now = function() return (time and time.ticks_ms) and time.ticks_ms() or 0 end

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
  trigger = {
    new = function(name)
      local v = __bench.t[name]
      return setmetatable({ name = name, p = v and v[1], r = v and v[2] }, T)
    end,
  }
end
__bench.since = {}

local function sensor(key, default)
  return function() return __bench.s[key] or default end
end
if not light then
  light = { read = sensor("light", { level = 0.5, lux = 300, raw = 2048 }) }
  function light.level() return light.read().level end
end
if not pir then
  pir = { read = sensor("pir", { motion = false }) }
  function pir.motion() return pir.read().motion end
end
if not climate then
  climate = { read = sensor("climate", { temperature = 21, humidity = 40 }) }
  function climate.temperature() return climate.read().temperature end
  function climate.humidity() return climate.read().humidity end
end
if not touch then
  touch = { read = sensor("touch", { touched = false, raw = 0 }) }
  function touch.touched() return touch.read().touched end
end
if not ld2410 then
  ld2410 = {
    begin = function() end,
    read = sensor("radar", { connected = true, moving = false, still = false, distance_cm = 0, moving_cm = 0,
      moving_energy = 0, still_cm = 0, still_energy = 0, out = false }),
  }
end
if not imu then
  imu = {
    accel = function() local a = __bench.s.imu or { 0, 0, 1 } return a[1], a[2], a[3] end,
    gyro = function() return 0, 0, 0 end,
    temp = function() return 0 end,
  }
end

-- Apply one update from Bench, and raise the driver events the app would get on Bench itself.
local function __bench_apply(ctx, data, deliver)
  for name, v in pairs(data.d or {}) do
    local was = __bench.d[name]
    __bench.d[name] = v
    if was and was[1] ~= v[1] then deliver(ctx, "dial", { name = name, value = v[1], delta = v[3] - was[3] }) end
  end
  for name, v in pairs(data.t or {}) do
    local was = __bench.t[name]
    __bench.t[name] = v
    if v[3] == 1 and not (was and was[3] == 1) then __bench.since[name] = __now() end
    if was then
      local button = name == "@a" and 0 or name == "@b" and 1 or nil
      for _ = was[1] + 1, v[1] do
        if button then
          -- Bench's button A or B, driven by a part there: a tap here.
          __bench.taps = (__bench.taps or 0) + 1
          deliver(ctx, "tap", { index = button, count = __bench.taps })
          deliver(ctx, "button", { index = button, count = __bench.taps })
        else
          deliver(ctx, "trigger", { name = name, pressed = true })
        end
      end
      if not button then
        for _ = was[2] + 1, v[2] do deliver(ctx, "trigger", { name = name, pressed = false }) end
      end
    end
  end
  local s = data.s or {}
  local before = __bench.s
  __bench.s = s
  -- Changes only: the first reading of a sensor is where it starts, not an event.
  if s.pir and before.pir and before.pir.motion ~= s.pir.motion then deliver(ctx, "motion", { moving = s.pir.motion }) end
  if s.touch and before.touch and before.touch.touched ~= s.touch.touched then deliver(ctx, "touch", { touched = s.touch.touched }) end
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
    if app_on_event then return app_on_event(ctx, e) end
  end
end
