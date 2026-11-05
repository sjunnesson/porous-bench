-- From inanimate-tech/resident examples/m5stick-demo/device-apps/accel.lua (MIT)
-- Accel: visualize accelerometer data as a moving dot
-- @needs motion
local dx, dy -- where the dot was drawn: only that's redrawn, so a flip pushes only what moved
function on_tick(ctx, dt_ms)
  local ax, ay, az = imu.accel()
  local w = screen.width()
  local h = screen.height()

  -- Map accelerometer to screen position (centered)
  local cx = math.floor(w / 2 + ax * w / 2)
  local cy = math.floor(h / 2 + ay * h / 2)

  -- Clamp to screen
  cx = math.max(4, math.min(w - 4, cx))
  cy = math.max(4, math.min(h - 4, cy))

  local lx, ly = w // 2 - 1, h // 2 - 1
  if dx then
    -- Where the dot was: the ground, and any of the crosshair under it
    screen.fill_rect(dx - 4, dy - 4, 8, 8, 0, 0, 20)
    if dx - 4 < lx + 2 and dx + 4 > lx then screen.fill_rect(lx, dy - 4, 2, 8, 30, 30, 60) end
    if dy - 4 < ly + 2 and dy + 4 > ly then screen.fill_rect(dx - 4, ly, 8, 2, 30, 30, 60) end
  else
    screen.clear(0, 0, 20)
    -- Crosshair
    screen.fill_rect(lx, 0, 2, h, 30, 30, 60)
    screen.fill_rect(0, ly, w, 2, 30, 30, 60)
  end
  dx, dy = cx, cy
  -- Dot
  screen.fill_rect(cx - 4, cy - 4, 8, 8, 0, 255, 100)
  screen.flip()
end
