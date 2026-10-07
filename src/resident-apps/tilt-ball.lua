-- Tilt ball: roll a ball with the IMU, bounce off the walls with a click. Hold a button to reset.
-- @needs motion
local g = lgfx.bind("main")
local W, H = g:width(), g:height()
local R = math.max(4, math.min(W, H) // 12)
local x, y, vx, vy = W / 2, H / 2, 0, 0
local hits = 0

local function wall()
  hits = hits + 1
  buzzer.beep(300 + (hits % 5) * 120, 25)
end

function on_tick(ctx, dt_ms)
  local dt = dt_ms / 1000
  local ax, ay = imu.accel()
  vx = (vx + ax * 600 * dt) * 0.98
  vy = (vy + ay * 600 * dt) * 0.98
  x, y = x + vx * dt, y + vy * dt
  if x < R then x, vx = R, -vx * 0.7 wall() elseif x > W - R then x, vx = W - R, -vx * 0.7 wall() end
  if y < R then y, vy = R, -vy * 0.7 wall() elseif y > H - R then y, vy = H - R, -vy * 0.7 wall() end

  g:fillScreen(0x101820)
  for gx = 0, W, 20 do g:drawLine(gx, 0, gx, H, 0x1E2C3A) end
  for gy = 0, H, 20 do g:drawLine(0, gy, W, gy, 0x1E2C3A) end
  g:fillCircle(math.floor(x), math.floor(y), R, 0x3DDC84)
  g:drawCircle(math.floor(x), math.floor(y), R, 0xFFFFFF)
  g:setTextColor(0x8899AA)
  g:setCursor(4, 4)
  g:print("hits " .. hits)
  g:flip()
end

function on_event(ctx, e)
  if e.name == "hold" and e.data.held then
    x, y, vx, vy, hits = W / 2, H / 2, 0, 0, 0
  end
end
