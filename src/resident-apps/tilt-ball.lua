-- Tilt ball: roll a ball with the IMU, bounce off the walls with a click. Hold a button to reset.
-- @needs motion
local g = lgfx.bind("main")
local W, H = g:width(), g:height()
local R = math.max(4, math.min(W, H) // 12)
local x, y, vx, vy = W / 2, H / 2, 0, 0
local hits = 0
local bx, by -- where the ball was drawn: only that's redrawn, so a flip pushes only what moved
local shown = -1

-- The ground and its grid, within a box.
local function ground(x0, y0, x1, y1)
  x0, y0, x1, y1 = math.max(0, x0), math.max(0, y0), math.min(W, x1), math.min(H, y1)
  g:fillRect(x0, y0, x1 - x0 + 1, y1 - y0 + 1, 0x101820)
  for gx = (x0 + 19) // 20 * 20, x1, 20 do g:drawLine(gx, y0, gx, y1, 0x1E2C3A) end
  for gy = (y0 + 19) // 20 * 20, y1, 20 do g:drawLine(x0, gy, x1, gy, 0x1E2C3A) end
end

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

  local nx, ny = math.floor(x), math.floor(y)
  if nx == bx and ny == by and hits == shown then return end
  local overText = (bx and bx - R - 1 < 84 and by - R - 1 < 20) or (nx - R - 1 < 84 and ny - R - 1 < 20)
  if bx then ground(bx - R - 1, by - R - 1, bx + R + 1, by + R + 1) else ground(0, 0, W, H) end
  bx, by = nx, ny
  g:fillCircle(nx, ny, R, 0x3DDC84)
  g:drawCircle(nx, ny, R, 0xFFFFFF)
  -- The text: when it changed, or the ball has been over it (it's about 80 × 16 px)
  if hits ~= shown or overText then
    if hits ~= shown then ground(0, 0, 84, 20) end
    shown = hits
    g:setTextColor(0x8899AA)
    g:setCursor(4, 4)
    g:print("hits " .. hits)
  end
  g:flip()
end

function on_event(ctx, e)
  if e.name == "hold" and e.data.held then
    x, y, vx, vy, hits = W / 2, H / 2, 0, 0, 0
  end
end
