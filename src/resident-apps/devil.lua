-- Little devil: a cute chibi devil that reacts to the LD2410 radar. It naps when nobody's there, schemes when you linger, pops up with a boo when you come close and gets cozy if you stay. A pokes it.
local g = lgfx.bind("main")
local s = screens.get("main")
local W, H = g:width(), g:height()
local color = s.depth == 16
local paper = s.scheme == "light" -- e-paper: redraw on a mood change, or every few seconds
local BG = paper and 0xFFFFFF or 0x000000
local FG = paper and 0x000000 or 0xFFFFFF
local I = math.floor
local STYLE_BODY -- the body colour this frame (sleepy or not), for the face to paint over

ld2410.begin({ mode = "wander" })

-- Palette: a soft coral devil on colour screens; a lit silhouette with dark features on 1-bit ones.
local C = color and {
  body = 0xF25C54, sleepy = 0xC9605A, light = 0xFF9A8F, horn = 0xFFE8C2, eye = 0x2B1B2E, shine = 0xFFFFFF,
  mouth = 0x5A1F2B, blush = 0xFF9EB5, fx = 0xFFD166, text = 0xFFFFFF,
  dim = 0x7B7D7B, heart = 0xFF6F91, tongue = 0xFF8FA3,
} or {
  body = FG, sleepy = FG, horn = FG, eye = BG, shine = FG, mouth = BG,
  fx = FG, text = FG, dim = FG, heart = FG, tongue = BG,
}

-- Size: the head's radius, from the screen. Tiny screens get the head alone.
local compact = H < 48
-- It reaches 1.2 heads to the left (paws up) and 1.8 to the right (the tail), so centre that span.
local S = compact and I(H * 0.38) or I(math.min(W / 3.45, H * 0.32))
local CX = compact and I(W * 0.3) or I((W - 3.0 * S) / 2 + 1.2 * S)
local CY = compact and I(H / 2) or I(H * 0.44)

-- ── drawing helpers (lgfx wants integers) ───────────────────────────────────

local function circ(x, y, r, c) g:fillCircle(I(x), I(y), math.max(1, I(r)), c) end
local function tri(x0, y0, x1, y1, x2, y2, c) g:fillTriangle(I(x0), I(y0), I(x1), I(y1), I(x2), I(y2), c) end
local function line(x0, y0, x1, y1, c) g:drawLine(I(x0), I(y0), I(x1), I(y1), c) end
local function thick(x0, y0, x1, y1, w, c)
  for k = 0, w - 1 do line(x0 + k - w // 2, y0, x1 + k - w // 2, y1, c) end
end
-- An arc as short line segments: centre, radii, angles in radians (0 = right, π/2 = down).
local function arc(x, y, rx, ry, a0, a1, c, w)
  local n = 10
  local px, py = x + math.cos(a0) * rx, y + math.sin(a0) * ry
  for k = 1, n do
    local a = a0 + (a1 - a0) * k / n
    local nx, ny = x + math.cos(a) * rx, y + math.sin(a) * ry
    thick(px, py, nx, ny, w or 1, c)
    px, py = nx, ny
  end
end
local function heart(x, y, r, c)
  circ(x - r * 0.5, y, r * 0.55, c)
  circ(x + r * 0.5, y, r * 0.55, c)
  tri(x - r * 1.02, y + r * 0.15, x + r * 1.02, y + r * 0.15, x, y + r * 1.25, c)
end
local function text(str, x, y, size, c)
  -- Keep it on the screen, clear of rounded corners.
  local hw, hh, m = #str * 3 * size, 4 * size, 8
  x = math.max(hw + m, math.min(W - hw - m, x))
  y = math.max(hh + m, y)
  g:setTextSize(size)
  g:setTextColor(c)
  g:setTextDatum(lgfx.MC_DATUM)
  g:drawString(str, I(x), I(y))
end

-- ── the devil ───────────────────────────────────────────────────────────────

-- How each mood moves: bob amplitude and speed, tail wag, where the eyes look, and its face.
local STYLE = {
  sleeping  = { bob = 0.05, speed = 0.9, wag = 0.2, face = "asleep" },
  bored     = { bob = 0.03, speed = 1.2, wag = 0.4, face = "meh" },
  curious   = { bob = 0.04, speed = 2.0, wag = 0.6, face = "wide" },
  scheming  = { bob = 0.03, speed = 1.6, wag = 0.8, face = "sly" },
  excited   = { bob = 0.22, speed = 9.0, wag = 2.2, face = "grin", hop = true },
  boo       = { bob = 0.18, speed = 12, wag = 2.5, face = "boo", hop = true, shake = true },
  cozy      = { bob = 0.04, speed = 1.4, wag = 0.5, face = "content" },
  surprised = { bob = 0.25, speed = 6.0, wag = 1.5, face = "shock", hop = true },
  pout      = { bob = 0.02, speed = 1.0, wag = 0.1, face = "pout" },
  giggle    = { bob = 0.10, speed = 14, wag = 1.8, face = "grin" },
}

local function eyes(x, y, s, face, t)
  local ex, ey = s * 0.4, y + s * 0.02
  if face == "asleep" or face == "content" then
    -- Closed: sleepy arcs, or happy ^ ^.
    for sx = -1, 1, 2 do
      if face == "asleep" then arc(x + sx * ex, ey, s * 0.2, s * 0.13, 0.25, math.pi - 0.25, C.mouth, 2)
      else arc(x + sx * ex, ey + s * 0.08, s * 0.18, s * 0.16, math.pi + 0.35, 2 * math.pi - 0.35, C.mouth, 2) end
    end
    return
  end
  -- Big round eyes; the pupils' shine moves with where it's looking.
  local r = (face == "wide" or face == "shock") and s * 0.33 or s * 0.29
  local lx, ly = 0, 0
  if face == "meh" then lx, ly = math.sin(t * 0.7) * 0.25, 0.1
  elseif face == "wide" then lx, ly = math.sin(t * 0.4) * 0.1, -0.2
  elseif face == "sly" then lx, ly = 0.22, 0.05
  elseif face == "grin" then lx = math.sin(t * 5) * 0.15 end
  for sx = -1, 1, 2 do
    local x0, y0 = x + sx * ex + lx * r, ey + ly * r
    local h = face == "pout" and r * 0.75 or r
    circ(x0, y0, h, C.eye)
    if face == "sly" then -- a cheeky half-lidded look
      tri(x0 - h * 1.1, y0 - h * 1.1, x0 + h * 1.1, y0 - h * 1.1, x0 + sx * h * 1.1, y0 - h * 0.1, C.body)
    end
    circ(x0 - r * 0.3, y0 - r * 0.35, r * 0.3, C.shine) -- sparkle
    circ(x0 + r * 0.3, y0 + r * 0.3, math.max(1, r * 0.13), C.shine)
  end
end

local function mouth(x, y, s, face, t)
  local my = y + s * 0.45
  if face == "grin" then
    -- A wide open smile with a little tongue.
    circ(x, my - s * 0.02, s * 0.18, C.mouth)
    g:fillRect(I(x - s * 0.19), I(my - s * 0.21), I(s * 0.38) + 1, I(s * 0.19), STYLE_BODY or C.body)
    circ(x, my + s * 0.06, s * 0.08, C.tongue)
  elseif face == "sly" then
    arc(x + s * 0.05, my - s * 0.08, s * 0.16, s * 0.1, 0.2, math.pi - 0.6, C.mouth, 2)
  elseif face == "boo" or face == "shock" then
    circ(x, my + s * 0.02, (face == "boo" and 0.15 or 0.1) * s, C.mouth)
  elseif face == "content" then
    -- A little cat smile: ω
    arc(x - s * 0.08, my - s * 0.06, s * 0.08, s * 0.08, 0.1, math.pi - 0.1, C.mouth, 2)
    arc(x + s * 0.08, my - s * 0.06, s * 0.08, s * 0.08, 0.1, math.pi - 0.1, C.mouth, 2)
  elseif face == "pout" then
    arc(x, my + s * 0.08, s * 0.12, s * 0.08, math.pi + 0.4, 2 * math.pi - 0.4, C.mouth, 2)
  elseif face == "asleep" then
    circ(x, my, s * 0.04 + math.abs(math.sin(t * 0.9)) * s * 0.03, C.mouth)
  elseif face == "wide" then
    circ(x, my, s * 0.06, C.mouth) -- a little "o"
  else -- meh: a small, unbothered smile
    arc(x, my - s * 0.06, s * 0.1, s * 0.06, 0.4, math.pi - 0.4, C.mouth, 2)
  end
end

local function devil(mood, t)
  local st = STYLE[mood]
  local s = S * (mood == "boo" and 1.08 or 1)
  local bob = st.hop and -math.abs(math.sin(t * st.speed)) * st.bob * S or math.sin(t * st.speed) * st.bob * S
  local x = CX + (st.shake and math.sin(t * 40) * S * 0.04 or 0)
  local y = CY + bob + (mood == "pout" and S * 0.06 or 0)
  local body = mood == "sleeping" and C.sleepy or C.body
  STYLE_BODY = body
  local bx, by = x, y + s * 0.92

  if not compact then
    -- The tail: a tapering S-curve from behind the body, sweeping out low and curling up beside
    -- it, clear of the head. Drawn as overlapping dots along a Bézier curve, so it's thick at the
    -- base and thin at the tip; the wag swings the tip side to side. It droops when sad or asleep.
    local wag = math.sin(t * (1.5 + st.wag * 3)) * (0.08 + st.wag * 0.07)
    local droop = (mood == "pout" or mood == "sleeping") and 0.45 or 0
    local x0, y0 = bx + s * 0.18, by + s * 0.2 -- base, behind the body
    local x1, y1 = bx + s * 0.9, by + s * 0.62 -- swings out low
    local x2, y2 = bx + s * (1.55 + wag * 0.3), by + s * (0.25 + droop * 0.5)
    local x3, y3 = bx + s * (1.42 + wag * 1.2), by - s * (0.35 - droop)
    local N = 18
    for k = 0, N do
      local u = k / N
      local v = 1 - u
      local px = v * v * v * x0 + 3 * v * v * u * x1 + 3 * v * u * u * x2 + u * u * u * x3
      local py = v * v * v * y0 + 3 * v * v * u * y1 + 3 * v * u * u * y2 + u * u * u * y3
      circ(px, py, s * (0.1 - 0.055 * u), body)
    end
    heart(x3, y3 - s * 0.12, s * 0.21, body)

    -- A tiny body tucked under the head, with tiny feet.
    circ(bx, by, s * 0.36, body)
    circ(bx - s * 0.16, by + s * 0.32, s * 0.1, body)
    circ(bx + s * 0.16, by + s * 0.32, s * 0.1, body)
    if mood == "boo" then -- both paws up: peekaboo!
      for sx = -1, 1, 2 do circ(x + sx * s * 1.02, y - s * 0.2 + math.sin(t * 20) * s * 0.04, s * 0.13, body) end
    end
  end

  -- Horn nubs (rounded), head, face, rosy cheeks.
  for sx = -1, 1, 2 do
    local hx, hy = x + sx * s * 0.55, y - s * 0.72
    tri(hx - s * 0.17, hy + s * 0.12, hx + s * 0.17, hy + s * 0.12, hx + sx * s * 0.12, hy - s * 0.3, C.horn)
    circ(hx + sx * s * 0.1, hy - s * 0.24, s * 0.07, C.horn)
  end
  circ(x, y, s, body)
  if color and mood ~= "sleeping" then circ(x - s * 0.42, y - s * 0.45, s * 0.16, C.light) end
  if color then
    local blush = mood == "cozy" and 0.2 or 0.14
    circ(x - s * 0.66, y + s * 0.3, s * blush, C.blush)
    circ(x + s * 0.66, y + s * 0.3, s * blush, C.blush)
  end
  eyes(x, y, s, st.face, t)
  mouth(x, y, s, st.face, t)
  return x, y, s
end

-- Little extras around it, per mood.
local function effects(mood, t, x, y, s)
  local top = y - s * 1.6
  local big = S >= 20 and 2 or 1
  if mood == "sleeping" then
    for k = 0, 2 do
      local p = (t * 0.35 + k / 3) % 1
      text("z", x + s * 0.9 + p * s * 0.9, y - s * 0.6 - p * s * 1.4, k == 2 and big or 1, C.dim)
    end
  elseif mood == "curious" then
    text("?", x + s * 1.3, top + math.sin(t * 3) * 3, big, C.fx)
  elseif mood == "surprised" then
    text("!", x + s * 1.25, top, big + 1, C.fx)
  elseif mood == "scheming" and (t % 3) < 1.2 then
    text("hehe", x + s * 1.25, y - s * 1.15, 1, C.fx)
  elseif mood == "excited" then
    for k = 0, 3 do
      local a = t * 2 + k * math.pi / 2
      local sx, sy = x + math.cos(a) * s * 1.9, y + math.sin(a) * s * 1.2
      line(sx - 3, sy, sx + 3, sy, C.fx)
      line(sx, sy - 3, sx, sy + 3, C.fx)
    end
  elseif mood == "boo" then
    text("boo!", x - s * 1.35, y - s * 1.05, big, C.text)
    for k = 0, 2 do -- little pops of stars
      local a = t * 3 + k * 2.1
      local sx, sy = x + math.cos(a) * s * 1.55, y - s * 0.3 + math.sin(a) * s * 0.9
      line(sx - 3, sy, sx + 3, sy, C.fx)
      line(sx, sy - 3, sx, sy + 3, C.fx)
    end
  elseif mood == "cozy" then
    for k = 0, 1 do
      local p = (t * 0.5 + k * 0.5) % 1
      heart(x + s * (1.2 + k * 0.4), y - s * (0.5 + p * 1.2), s * 0.16, C.heart)
    end
  elseif mood == "pout" then
    text("hmph", x - s * 1.5, top + s * 0.5, 1, C.fx)
  elseif mood == "giggle" then
    text("hihi", x + s * 1.25, y - s * 1.15, 1, C.fx)
  end
end

-- ── what the radar says → mood ──────────────────────────────────────────────

local LABEL = {
  sleeping = "asleep", bored = "bored", curious = "curious", scheming = "scheming", excited = "excited",
  boo = "boo!", cozy = "cozy", surprised = "startled", pout = "pouting", giggle = "giggling",
}
local mood, shown = "bored", nil
local reaction, reactionUntil = nil, 0
local emptySince, closeSince = 0, nil
local present = false
local lastBoo = -1e9
local lastDraw = -1e9
local reading = { distance_cm = 0 }

local function react(m, ms, now)
  reaction, reactionUntil = m, now + ms
end

local NEAR = 150 -- cm: "close". The LD2410 reports in 0.75 m gates, so keep this generous.

local function decide(r, now)
  if reaction and now < reactionUntil then return reaction end
  reaction = nil
  local here = r.moving or r.still
  local d = r.distance_cm
  if not here then
    closeSince = nil
    return (now - emptySince > 8000) and "sleeping" or "bored"
  end
  if r.moving and d < NEAR then return "boo" end
  if r.moving then closeSince = nil return "excited" end
  if d < NEAR then
    closeSince = closeSince or now
    return (now - closeSince > 4000) and "cozy" or "scheming"
  end
  closeSince = nil
  return d < 300 and "scheming" or "curious"
end

local function draw(now)
  local t = now / 1000
  g:fillScreen(BG)
  local x, y, sz = devil(mood, t)
  if not compact then effects(mood, t, x, y, sz) end
  -- Status: the mood, and the distance when someone's there.
  local status = LABEL[mood]
  if mood ~= "sleeping" and mood ~= "bored" and mood ~= "pout" and reading.distance_cm > 0 then
    status = status .. string.format("  %.1f m", reading.distance_cm / 100)
  end
  g:setTextSize(1)
  g:setTextColor(C.dim)
  if compact then
    g:setTextDatum(lgfx.ML_DATUM)
    g:drawString(status, I(W * 0.58), I(H / 2))
  elseif H >= 64 then
    g:setTextDatum(lgfx.BC_DATUM)
    g:drawString(status, W // 2, H - 2)
  end
  g:flip()
end

function on_tick(ctx, dt_ms)
  local now = ctx.time_ms
  reading = ld2410.read()
  mood = decide(reading, now)
  if mood == "boo" and now - lastBoo > 3000 then
    lastBoo = now
    buzzer.beep(880, 60)
  end
  if paper and mood == shown and now - lastDraw < 4000 then return end
  shown, lastDraw = mood, now
  draw(now)
end

function on_event(ctx, e)
  local now = ctx.time_ms
  if e.name == "presence" then
    local here = e.data.moving or e.data.still
    if here and not present then
      react("surprised", 1200, now) -- someone appeared
      log.info("someone's here (" .. e.data.distance_cm .. " cm)")
    elseif present and not here then
      emptySince = now
      react("pout", 2000, now) -- they left
      log.info("they left")
    end
    present = here
  elseif e.name == "tap" and e.data.index == 0 then
    react("giggle", 1000, now)
    buzzer.beep(1760, 30)
  end
end
