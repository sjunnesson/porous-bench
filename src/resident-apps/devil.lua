-- Little devil: a chibi devil that naps, schemes and says boo as you come near the radar. A pokes it.
local h = lvgl.bind("main")
local s = screens.get("main")
local W, H = h.HOR_RES(), h.VER_RES()
local color = s.depth == 16
local paper = s.scheme == "light" -- e-paper: no animation (every refresh is a slow one); jump to end states
local BG = paper and 0xFFFFFF or 0x000000
local FG = paper and 0x000000 or 0xFFFFFF
local I = math.floor
local CIRCLE = lvgl.RADIUS_CIRCLE
local HIDDEN = lvgl.FLAG.HIDDEN
local FLOAT = lvgl.FLAG.OVERFLOW_VISIBLE
local FOREVER = lvgl.ANIM_REPEAT_INFINITE

ld2410.begin({ mode = "wander" })

-- Palette: a soft coral devil on colour screens; a lit silhouette with dark features on 1-bit ones.
local C = color and {
  body = 0xF25C54, sleepy = 0xC9605A, light = 0xFF9A8F, horn = 0xFFE8C2, eye = 0x2B1B2E, shine = 0xFFFFFF,
  mouth = 0x5A1F2B, blush = 0xFF9EB5, fx = 0xFFD166, text = 0xFFFFFF, dim = 0x7B7D7B, heart = 0xFF6F91,
  tongue = 0xFF8FA3,
} or {
  body = FG, sleepy = FG, horn = FG, eye = BG, shine = FG, mouth = BG, fx = FG, text = FG, dim = FG,
  heart = FG, tongue = BG,
}

h:set_theme {
  screen = { bg_color = BG },
  object = { bg_opa = 0, border_width = 0, pad_all = 0, radius = 0 },
  label = { text_color = C.text, text_font = lvgl.Font("montserrat", 14) },
}

-- Size: the head's radius, from the screen. Tiny screens get the head alone.
local compact = H < 48
-- It reaches 1.2 heads to the left (paws up) and 1.8 to the right (the tail), so centre that span.
local S = compact and I(H * 0.38) or I(math.min(W / 3.45, H * 0.32))
local CX = compact and I(W * 0.3) or I((W - 3.0 * S) / 2 + 1.2 * S)
local CY = compact and I(H / 2) or I(H * 0.44)
local STROKE = math.max(2, I(S * 0.06)) -- line width for closed eyes and small mouths

-- ── building blocks ─────────────────────────────────────────────────────────

-- Every animation goes through here: on e-paper it jumps straight to its end state.
local function anim(obj, para)
  if paper then
    if para.exec_cb then para.exec_cb(obj, para.end_value) end
    return nil
  end
  para.run = para.run ~= false
  return obj:Anim(para)
end

local function group(parent, x, y, w, hh)
  local g = parent:Object { x = I(x), y = I(y), w = math.max(1, I(w)), h = math.max(1, I(hh)) }
  g:add_flag(FLOAT)
  return g
end
local function box(parent, x, y, w, hh, c, radius, extra)
  local p = { x = I(x), y = I(y), w = math.max(1, I(w)), h = math.max(1, I(hh)), bg_color = c, bg_opa = 255, radius = radius or 0 }
  if extra then for k, v in pairs(extra) do p[k] = v end end
  return parent:Object(p)
end
local function dot(parent, cx, cy, r, c) return box(parent, cx - r, cy - r, 2 * r, 2 * r, c, CIRCLE) end
local function arcPts(cx, cy, rx, ry, a0, a1)
  local pts = {}
  for k = 0, 10 do
    local a = a0 + (a1 - a0) * k / 10
    pts[#pts + 1] = { I(cx + math.cos(a) * rx), I(cy + math.sin(a) * ry) }
  end
  return pts
end
-- A curve as a Line placed at its parent's origin, so its points are in the parent's coordinates.
local function curve(parent, pts, width, c)
  return parent:Line { x = 0, y = 0, points = pts, line_width = math.max(1, I(width)), line_color = c, line_rounded = true }
end
-- A heart: two circles and a square turned 45°, in a group of 2r × 2r.
local function fillHeart(g, r, c)
  local side = I(r * 1.15)
  box(g, r - side / 2, r - side / 2 + r * 0.2, side, side, c, I(r * 0.15), {
    transform_rotation = 450, transform_pivot_x = I(side / 2), transform_pivot_y = I(side / 2),
  })
  dot(g, r - r * 0.48, r - r * 0.1, r * 0.56, c)
  dot(g, r + r * 0.48, r - r * 0.1, r * 0.56, c)
end
local function heart(parent, r, c)
  local g = group(parent, 0, 0, 2 * r, 2 * r)
  fillHeart(g, r, c)
  return g
end
local function label(parent, text, size, c)
  return parent:Label { text = text, text_color = c, text_font = lvgl.Font("montserrat", size) }
end

-- ── the devil ───────────────────────────────────────────────────────────────

-- Everything moves together inside the rig: bobbing, hopping and the boo shake animate the rig.
local rig = group(h.screen(), 0, 0, W, H)
local bodyParts = {} -- recoloured when it falls asleep
local function bodyColored(o) bodyParts[#bodyParts + 1] = o return o end

local bx, by = CX, CY + I(S * 0.92) -- the little body, under the head

-- The tail: a tapering curve (three Lines, thick to thin) ending in a heart. The wag Anim
-- recomputes its points; it droops when the devil is sad or asleep.
local tail, tailHeart, HR = {}, nil, I(S * 0.21)
local droop = 0
local function tailPoints(wag)
  local x0, y0 = bx + S * 0.18, by + S * 0.2
  local x1, y1 = bx + S * 0.9, by + S * 0.62
  local x2, y2 = bx + S * (1.55 + wag * 0.3), by + S * (0.25 + droop * 0.5)
  local x3, y3 = bx + S * (1.42 + wag * 1.2), by - S * (0.35 - droop)
  local pts = {}
  for k = 0, 15 do
    local u = k / 15
    local v = 1 - u
    pts[#pts + 1] = {
      I(v * v * v * x0 + 3 * v * v * u * x1 + 3 * v * u * u * x2 + u * u * u * x3),
      I(v * v * v * y0 + 3 * v * v * u * y1 + 3 * v * u * u * y2 + u * u * u * y3),
    }
  end
  return pts
end
local function slice(pts, a, b) local out = {} for i = a, b do out[#out + 1] = pts[i] end return out end
local function setTail(wag)
  local pts = tailPoints(wag)
  tail[1]:set { points = slice(pts, 1, 7) }
  tail[2]:set { points = slice(pts, 7, 12) }
  tail[3]:set { points = slice(pts, 12, 16) }
  tailHeart:set { x = pts[16][1] - HR, y = pts[16][2] - HR - I(S * 0.12) }
end

if not compact then
  local p = tailPoints(0)
  tail[1] = bodyColored(curve(rig, slice(p, 1, 7), S * 0.2, C.body))
  tail[2] = bodyColored(curve(rig, slice(p, 7, 12), S * 0.15, C.body))
  tail[3] = bodyColored(curve(rig, slice(p, 12, 16), S * 0.1, C.body))
  tailHeart = heart(rig, HR, C.body)
  setTail(0)

  -- A tiny body tucked under the head, with tiny feet.
  bodyColored(dot(rig, bx, by, S * 0.36, C.body))
  bodyColored(dot(rig, bx - S * 0.16, by + S * 0.32, S * 0.1, C.body))
  bodyColored(dot(rig, bx + S * 0.16, by + S * 0.32, S * 0.1, C.body))
end

-- Horn nubs: rounded, cream, tilted outwards.
for sx = -1, 1, 2 do
  local hw, hh = S * 0.3, S * 0.46
  box(rig, CX + sx * S * 0.55 - hw / 2, CY - S * 0.98, hw, hh, C.horn, I(hw / 2), {
    transform_rotation = sx * 220, transform_pivot_x = I(hw / 2), transform_pivot_y = I(hh),
  })
end

-- Paws, up for the boo.
local paws = {}
if not compact then
  for sx = -1, 1, 2 do
    local p = bodyColored(dot(rig, CX + sx * S * 1.02, CY - S * 0.2, S * 0.13, C.body))
    p:add_flag(HIDDEN)
    paws[#paws + 1] = p
  end
end

-- Head, shine and cheeks.
bodyColored(dot(rig, CX, CY, S, C.body)) -- the head
local shine = color and dot(rig, CX - S * 0.42, CY - S * 0.45, S * 0.16, C.light) or nil
local cheeks = {}
if color then
  for sx = -1, 1, 2 do cheeks[#cheeks + 1] = dot(rig, CX + sx * S * 0.66, CY + S * 0.3, S * 0.14, C.blush) end
end

-- Eyes: each in its own group, so a glance moves it and a surprise scales it.
local ER = S * 0.29
local eyes, lids = {}, {}
for sx = -1, 1, 2 do
  local ex, ey = CX + sx * S * 0.4, CY + S * 0.02
  local g = group(rig, ex - ER, ey - ER, 2 * ER, 2 * ER)
  g:set { transform_pivot_x = I(ER), transform_pivot_y = I(ER) }
  dot(g, ER, ER, ER, C.eye)
  dot(g, ER - ER * 0.3, ER - ER * 0.35, ER * 0.3, C.shine)
  dot(g, ER + ER * 0.3, ER + ER * 0.3, math.max(1, ER * 0.13), C.shine)
  -- A cheeky half-lid for scheming: a slice of head colour over the top of the eye.
  local lid = bodyColored(box(g, -1, -1, 2 * ER + 2, ER * 0.9, C.body))
  lid:add_flag(HIDDEN)
  eyes[#eyes + 1] = g
  lids[#lids + 1] = lid
end

-- Faces: closed eyes for sleep and happiness, and a mouth per expression.
local my = CY + S * 0.45
local closed, happy = {}, {}
for sx = -1, 1, 2 do
  local ex = CX + sx * S * 0.4
  closed[#closed + 1] = curve(rig, arcPts(ex, CY + S * 0.02, S * 0.2, S * 0.13, 0.25, math.pi - 0.25), STROKE, C.mouth)
  happy[#happy + 1] = curve(rig, arcPts(ex, CY + S * 0.1, S * 0.18, S * 0.16, math.pi + 0.35, 2 * math.pi - 0.35), STROKE, C.mouth)
end
local mouths = {
  -- A wide open smile with a little tongue: a dark circle, its top half covered in head colour.
  grin = {
    dot(rig, CX, my - S * 0.02, S * 0.18, C.mouth),
    bodyColored(box(rig, CX - S * 0.19, my - S * 0.21, S * 0.38 + 1, S * 0.19, C.body)),
    dot(rig, CX, my + S * 0.06, S * 0.08, C.tongue),
  },
  sly = { curve(rig, arcPts(CX + S * 0.05, my - S * 0.08, S * 0.16, S * 0.1, 0.2, math.pi - 0.6), STROKE, C.mouth) },
  boo = { dot(rig, CX, my + S * 0.02, S * 0.15, C.mouth) },
  shock = { dot(rig, CX, my + S * 0.02, S * 0.1, C.mouth) },
  content = { -- a little cat smile: ω
    curve(rig, arcPts(CX - S * 0.08, my - S * 0.06, S * 0.08, S * 0.08, 0.1, math.pi - 0.1), STROKE, C.mouth),
    curve(rig, arcPts(CX + S * 0.08, my - S * 0.06, S * 0.08, S * 0.08, 0.1, math.pi - 0.1), STROKE, C.mouth),
  },
  pout = { curve(rig, arcPts(CX, my + S * 0.08, S * 0.12, S * 0.08, math.pi + 0.4, 2 * math.pi - 0.4), STROKE, C.mouth) },
  asleep = { dot(rig, CX, my, S * 0.05, C.mouth) },
  wide = { dot(rig, CX, my, S * 0.06, C.mouth) },
  meh = { curve(rig, arcPts(CX, my - S * 0.06, S * 0.1, S * 0.06, 0.4, math.pi - 0.4), STROKE, C.mouth) },
}

-- ── effects around it, one group per mood ───────────────────────────────────

local fx = {}
local function fxGroup(name)
  local g = group(rig, 0, 0, W, H)
  g:add_flag(HIDDEN)
  fx[name] = g
  return g
end
local top = CY - S * 1.6
local function clampX(x, w) return math.max(8, math.min(W - w - 8, I(x))) end
local function clampY(y) return math.max(8, I(y)) end
local big = S >= 20 and 20 or 14

if not compact then
  -- Asleep: three z's drifting up and fading, one after another.
  local z = fxGroup("sleeping")
  for k = 0, 2 do
    anim(label(z, "z", k == 2 and big or 14, C.dim), {
      start_value = 0, end_value = 1000, duration = 2700, delay = k * 900, repeat_count = FOREVER,
      exec_cb = function(o, v)
        local p = v / 1000
        o:set { x = I(CX + S * 0.9 + p * S * 0.9), y = clampY(CY - S * 0.6 - p * S * 1.4), opa = I(255 * (1 - p * p)) }
      end,
    })
  end
  -- Curious: a bobbing "?".
  local q = label(fxGroup("curious"), "?", big, C.fx)
  q:set { x = clampX(CX + S * 1.25, 12), y = clampY(top) }
  anim(q, { start_value = 0, end_value = -6, duration = 500, playback_time = 500, path = "ease_in_out",
    repeat_count = FOREVER, exec_cb = function(o, v) o:set { translate_y = v } end })
  -- Startled: "!".
  label(fxGroup("surprised"), "!", big + 8, C.fx):set { x = clampX(CX + S * 1.2, 10), y = clampY(top - 4) }
  -- Scheming: "hehe", blinking on and off.
  local he = label(fxGroup("scheming"), "hehe", 14, C.fx)
  he:set { x = clampX(CX + S * 1.1, 34), y = clampY(CY - S * 1.25) }
  anim(he, { start_value = 0, end_value = 255, duration = 600, playback_time = 600, repeat_delay = 1200,
    path = "ease_in_out", repeat_count = FOREVER, exec_cb = function(o, v) o:set { opa = v } end })
  -- Excited, and the boo: sparkles circling it.
  local function sparkles(g, n, rx, ry, period)
    for k = 0, n - 1 do
      anim(label(g, "+", 14, C.fx), { start_value = 0, end_value = 3600, duration = period, repeat_count = FOREVER,
        exec_cb = function(o, v)
          local a = v / 3600 * 2 * math.pi + k * 2 * math.pi / n
          o:set { x = I(CX + math.cos(a) * rx - 4), y = I(CY + math.sin(a) * ry - 8) }
        end })
    end
  end
  sparkles(fxGroup("excited"), 4, S * 1.9, S * 1.2, 3200)
  local boo = fxGroup("boo")
  label(boo, "boo!", big, C.text):set { x = clampX(CX - S * 1.35 - 18, 40), y = clampY(CY - S * 1.15) }
  sparkles(boo, 3, S * 1.55, S * 0.9, 2000)
  -- Cozy: hearts floating up and fading.
  local hearts = fxGroup("cozy")
  for k = 0, 1 do
    local hr = I(S * 0.16)
    anim(heart(hearts, hr, C.heart), {
      start_value = 0, end_value = 1000, duration = 2000, delay = k * 1000, repeat_count = FOREVER,
      exec_cb = function(o, v)
        local p = v / 1000
        o:set { x = I(CX + S * (1.2 + k * 0.4)) - hr, y = I(CY - S * (0.5 + p * 1.2)) - hr, opa = I(255 * (1 - p)) }
      end,
    })
  end
  label(fxGroup("pout"), "hmph", 14, C.fx):set { x = clampX(CX - S * 1.5 - 20, 40), y = clampY(top + S * 0.5) }
  label(fxGroup("giggle"), "hihi", 14, C.fx):set { x = clampX(CX + S * 1.1, 30), y = clampY(CY - S * 1.25) }
end

-- Status line: the mood, and the distance when someone's there.
local status = h.Label { text = "", text_color = C.dim, text_font = lvgl.Font("montserrat", compact and 8 or 14) }
if compact then status:set { align = lvgl.ALIGN.LEFT_MID, x = I(W * 0.58) }
elseif H >= 100 then status:set { align = lvgl.ALIGN.BOTTOM_MID, y = -2 } -- no room under its feet on short screens
else status:add_flag(HIDDEN) end

-- ── moods → how it looks and moves ──────────────────────────────────────────

-- Per mood: bob amplitude (in heads) and period, hops instead of a sway, how hard the tail wags,
-- the face, where the eyes look (or a glance / dart), and how big the eyes are.
local STYLE = {
  sleeping  = { bob = 0.05, period = 3000, wag = 0.2, face = "asleep", droop = 0.45 },
  bored     = { bob = 0.03, period = 2600, wag = 0.4, face = "meh", glance = true },
  curious   = { bob = 0.04, period = 1600, wag = 0.6, face = "wide", look = { 0, -0.2 }, scale = 1.12 },
  scheming  = { bob = 0.03, period = 2000, wag = 0.8, face = "sly", look = { 0.22, 0.05 } },
  excited   = { bob = 0.22, period = 360, wag = 2.2, face = "grin", hop = true, dart = true },
  boo       = { bob = 0.18, period = 260, wag = 2.5, face = "boo", hop = true, shake = true, scale = 1.15 },
  cozy      = { bob = 0.04, period = 2200, wag = 0.5, face = "content" },
  surprised = { bob = 0.25, period = 520, wag = 1.5, face = "shock", hop = true, scale = 1.15 },
  pout      = { bob = 0.02, period = 3000, wag = 0.1, face = "pout", droop = 0.45, scale = 0.8, sink = 0.06 },
  giggle    = { bob = 0.10, period = 220, wag = 1.8, face = "grin", hop = true },
}
local LABEL = {
  sleeping = "asleep", bored = "bored", curious = "curious", scheming = "scheming", excited = "excited",
  boo = "boo!", cozy = "cozy", surprised = "startled", pout = "pouting", giggle = "giggling",
}

local running = {} -- the current mood's Anims
local function show(o, on) if on then o:clear_flag(HIDDEN) else o:add_flag(HIDDEN) end end

local function applyMood(mood)
  local st = STYLE[mood]
  for _, a in pairs(running) do a:delete() end
  running = {}

  -- Face: eyes open or closed, which mouth, a half-lid for scheming, paws for the boo.
  local open = st.face ~= "asleep" and st.face ~= "content"
  for _, e in ipairs(eyes) do show(e, open) end
  for _, l in ipairs(lids) do show(l, st.face == "sly") end
  for _, c in ipairs(closed) do show(c, st.face == "asleep") end
  for _, c in ipairs(happy) do show(c, st.face == "content") end
  for face, parts in pairs(mouths) do for _, m in ipairs(parts) do show(m, face == st.face) end end
  for _, p in ipairs(paws) do show(p, mood == "boo") end
  for name, g in pairs(fx) do show(g, name == mood) end

  -- Colour: dimmer when asleep; rosier cheeks when cozy.
  local body = mood == "sleeping" and C.sleepy or C.body
  for _, o in ipairs(bodyParts) do
    if o.__kind == "Line" then o:set { line_color = body } else o:set { bg_color = body } end
  end
  if tailHeart then
    tailHeart:clean()
    fillHeart(tailHeart, HR, body)
  end
  if shine then show(shine, mood ~= "sleeping") end
  for i, c in ipairs(cheeks) do
    local r = mood == "cozy" and S * 0.2 or S * 0.14
    c:set { x = I(CX + (i == 1 and -1 or 1) * S * 0.66 - r), y = I(CY + S * 0.3 - r), w = I(2 * r), h = I(2 * r) }
  end

  -- Eyes: bigger when surprised, squinting when sulking; a fixed look, or a glance / dart around.
  local sc = I(256 * (st.scale or 1))
  for _, e in ipairs(eyes) do
    local look = st.look or { 0, 0 }
    e:set { transform_scale_x = sc, transform_scale_y = sc, translate_x = I(look[1] * ER), translate_y = I(look[2] * ER) }
  end
  if st.glance or st.dart then
    for i, e in ipairs(eyes) do
      running["eye" .. i] = anim(e, {
        start_value = -I(ER * 0.3), end_value = I(ER * 0.3),
        duration = st.dart and 260 or 1400, playback_time = st.dart and 260 or 1400, repeat_delay = st.dart and 0 or 900,
        path = "ease_in_out", repeat_count = FOREVER, exec_cb = function(o, v) o:set { translate_x = v } end,
      })
    end
  end
  if st.face == "asleep" then -- breathing: the little mouth grows and shrinks
    running.breath = anim(mouths.asleep[1], {
      start_value = I(S * 0.08), end_value = I(S * 0.16), duration = 1500, playback_time = 1500,
      path = "ease_in_out", repeat_count = FOREVER,
      exec_cb = function(o, v) o:set { w = v, h = v, x = CX - v // 2, y = I(my) - v // 2 } end,
    })
  end

  -- Body motion: a sway or hops for the whole rig, and a shake for the boo.
  local amp = I(st.bob * S)
  local sink = I((st.sink or 0) * S)
  rig:set { translate_x = 0, translate_y = sink }
  if st.hop then
    running.bob = anim(rig, { start_value = 0, end_value = -amp, duration = st.period // 2, playback_time = st.period // 2,
      path = "ease_out", repeat_count = FOREVER, exec_cb = function(o, v) o:set { translate_y = v } end })
  else
    running.bob = anim(rig, { start_value = -amp, end_value = amp, duration = st.period // 2, playback_time = st.period // 2,
      path = "ease_in_out", repeat_count = FOREVER, exec_cb = function(o, v) o:set { translate_y = v + sink } end })
  end
  if st.shake then
    running.shake = anim(rig, { start_value = -I(S * 0.04), end_value = I(S * 0.04), duration = 40, playback_time = 40,
      repeat_count = FOREVER, exec_cb = function(o, v) o:set { translate_x = v } end })
  end

  -- Tail: wags faster when it's excited, droops when it's sad or asleep.
  if tail[1] then
    droop = st.droop or 0
    local swing = I(100 * (0.08 + st.wag * 0.07))
    local half = I(1000 / (0.5 + st.wag))
    setTail(0)
    running.wag = anim(tail[3], { start_value = -swing, end_value = swing, duration = half, playback_time = half,
      path = "ease_in_out", repeat_count = FOREVER, exec_cb = function(_, v) setTail(v / 100) end })
  end
end

-- ── what the radar says → mood ──────────────────────────────────────────────

local NEAR = 150 -- cm: "close". The LD2410 reports in 0.75 m gates, so keep this generous.
local mood, shownMood, shownStatus = "bored", nil, nil
local reaction, reactionUntil = nil, 0
local emptySince, closeSince = 0, nil
local present = false
local lastBoo = -1e9
local lastPaper = -1e9

local function react(m, ms, now) reaction, reactionUntil = m, now + ms end

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

-- on_tick only decides the mood and updates the status text; the motion lives in the Anims.
function on_tick(ctx)
  local now = ctx.time_ms
  local r = ld2410.read()
  mood = decide(r, now)
  if mood == "boo" and now - lastBoo > 3000 then
    lastBoo = now
    buzzer.beep(880, 60)
  end
  if paper and shownMood ~= nil and now - lastPaper < 4000 then return end -- e-paper: change rarely
  lastPaper = now
  if mood ~= shownMood then
    shownMood = mood
    applyMood(mood)
  end
  local text = LABEL[mood]
  if mood ~= "sleeping" and mood ~= "bored" and mood ~= "pout" and r.distance_cm > 0 then
    text = text .. string.format("  %.1f m", r.distance_cm / 100)
  end
  if text ~= shownStatus then
    shownStatus = text
    status:set { text = text }
  end
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
