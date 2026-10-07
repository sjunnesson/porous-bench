-- La Linea: a light switch drawn as one line with a little man living in it. Tap: he pulls the line apart (off) or knits it back (on); drag up/down: he lifts the line to dim. Button A taps too, hold A to dim.
-- @output display
-- @needs motion
local h = lvgl.bind("main")
local s = screens.get("main")
local W, H = h.HOR_RES(), h.VER_RES()
local floor, min, max, abs = math.floor, math.min, math.max, math.abs
local sin, cos, sqrt, exp, pi, random = math.sin, math.cos, math.sqrt, math.exp, math.pi, math.random
local HIDDEN = lvgl.FLAG.HIDDEN
local mono = s.depth == 1

local function I(v) return floor(v + 0.5) end
local function clamp(v, a, b) return v < a and a or (v > b and b or v) end
local function lerp(a, b, t) return a + (b - a) * t end
local function ease(t) t = clamp(t, 0, 1) return t * t * (3 - 2 * t) end
local function bell(t) return sin(clamp(t, 0, 1) * pi) end -- 0 → 1 → 0
local function seg(u, a, b) return clamp((u - a) / (b - a), 0, 1) end -- u's progress through [a, b]
local function inOut(u) return ease(seg(u, 0, 0.2)) * (1 - ease(seg(u, 0.8, 1))) end -- in, hold, out

-- ── the stage ───────────────────────────────────────────────────────────────

local S = min(H * 0.5, W * 0.42) / 100 -- px per unit: the man is ~105 units tall
local BASE = I(H * 0.74)               -- the line
local LW = max(2, I(S * 2.4))
local GAP = 17 * S                      -- half the break while the lamp is off
local TAIL = 4 * S                      -- line sagging into a broken end
local REACH = 42 * S                    -- from his feet to where he works on the line
local DROOP = 7 * S
-- Where the line shows: a chord of round glass; on a rectangle, clear of the 6 px corners.
local X0, X1 = 0, W - 1
if s.shape == "round" then
  local r = W / 2
  local half = sqrt(max(0, r * r - (BASE - H / 2) ^ 2))
  X0, X1 = I(r - half), I(r + half)
end
local XMIN, XMAX = X0 + 24 * S + 6, X1 - 24 * S - 6 -- where his feet may stand

local OFF = mono and 0xFFFFFF or 0x4A535E
local LOW, HIGH, ROOM = 0xB48C58, 0xFFF4DA, 0xFFA040 -- the line dim and bright; the room it lights
local function mix(a, b, t)
  local function ch(sh) local x, y = (a >> sh) & 255, (b >> sh) & 255 return floor(x + (y - x) * t + 0.5) << sh end
  return ch(16) | ch(8) | ch(0)
end

h:set_theme {
  screen = { bg_color = 0x000000 },
  object = { bg_opa = 0, border_width = 0, pad_all = 0, radius = 0 },
  label = { text_color = HIGH, text_font = lvgl.Font("montserrat", H >= 200 and 20 or 14) },
}

-- The room: on AMOLED the lit lamp tints the whole glass, so the screen itself is the glow.
local room = h.Object { x = 0, y = 0, w = W, h = H, bg_color = 0x000000, bg_opa = 255 }
local function mkline(w, c)
  return h.Line { x = 0, y = 0, points = { { 0, BASE }, { 1, BASE } }, line_width = w, line_color = c,
    line_rounded = true }
end
-- Strokes: the man's outline, his inner legs, his near arm, up to three pieces of his far arm (what
-- pokes out from behind him), up to three runs of ground (it can be broken), and eight for the things
-- he plays with. Kept apart so LVGL only repaints what moved.
local strokes = {}
for i = 1, 17 do strokes[i] = mkline(LW, HIGH) end
local PROPS = 9 -- props use strokes PROPS + 1 ..
local scribble = mkline(max(1, LW - 1), HIGH) -- his grumbling
local pct = h.Label { text = "", text_opa = 0 }
local bang = h.Label { text = "!", text_opa = 0, text_font = lvgl.Font("montserrat", H >= 200 and 28 or 16) }
local zs = {}
for i = 1, 3 do zs[i] = h.Label { text = i == 3 and "Z" or "z", text_opa = 0 } end

-- ── the lamp ────────────────────────────────────────────────────────────────

local on, level = true, 70 -- what the switch says (sent at once)
local visOn = true         -- what the line shows (it changes when he's done the deed)
local lit = 1              -- 0..1, the line's light, faded
local flicker = nil        -- overrides lit while the lamp catches
local gapC = nil           -- where the line is broken, while off
local sentAt, dirty = -1e9, false

local function publish()
  store.set("on", on)
  store.set("level", level)
  events.send("lamp", { on = on, level = level }, { keep = true })
  dirty = false
end

-- ── the man ─────────────────────────────────────────────────────────────────
-- Units, in his own frame: u forward (the way he faces), v up from the line. Angles in radians.
-- Arms: 0 hangs down, +pi/2 points forward, pi straight up. b = far arm, f = near arm.

local P = { x = I(lerp(XMIN, XMAX, 0.35)), face = 1, sq = 0, lean = 0, hop = 0, sink = 0,
  fbu = -7, fbv = 0, ffu = 7, ffv = 0, b1 = -0.08, b2 = 0.15, f1 = 0.12, f2 = 0.2, jaw = 0, nod = 0, needles = 0,
  fall = 0, pv = 0 } -- fall: how far he's toppled (radians, + onto his back) about the foot at u = pv
local T = {}
for k, v in pairs(P) do T[k] = v end
local SMOOTH = { "sq", "lean", "hop", "sink", "fbu", "fbv", "ffu", "ffv", "b1", "b2", "f1", "f2", "jaw", "nod", "needles", "fall" }

local clock = 0
local function rest()
  T.sq, T.lean, T.hop, T.sink = 0, 0.02 * sin(clock * 1.7), 0, 0
  T.fbu, T.fbv, T.ffu, T.ffv = -7, 0, 7, 0
  T.b1, T.b2, T.f1, T.f2 = -0.08, 0.15, 0.12 + 0.02 * sin(clock * 1.7), 0.2
  T.jaw, T.nod, T.needles, T.fall = 0, 0, 0, 0
end

local LEG, A1, A2 = 23, 24, 22
local function rot(u, v, a) local c, sn = cos(a), sin(a) return u * c + v * sn, -u * sn + v * c end
local function hipOf(Q) return 0, 43 - 30 * Q.sq + Q.hop end
local function bodyPt(Q, u, v) local hu, hv = hipOf(Q) local ru, rv = rot(u, v, Q.lean) return hu + ru, hv + rv end
local function headPt(Q, u, v) local ru, rv = rot(u, v, Q.nod) return bodyPt(Q, 2 + ru, 40 + rv) end
local function shoulderOf(Q) return bodyPt(Q, 3, 34) end

local function knee(hu, hv, au, av) -- bends forward
  local dx, dy = au - hu, av - hv
  local d = sqrt(dx * dx + dy * dy)
  local mu, mv = (hu + au) / 2, (hv + av) / 2
  if d >= 2 * LEG or d < 0.01 then return mu, mv end
  local k = sqrt(LEG * LEG - d * d / 4) / d
  return mu - dy * k, mv + dx * k
end

local function ik(su, sv, tu, tv) -- shoulder and elbow angles that put the hand on (tu, tv)
  local dx, dy = tu - su, tv - sv
  local d = clamp(sqrt(dx * dx + dy * dy), 2, A1 + A2 - 0.01)
  local th = math.atan(dx, -dy)
  if th < -pi / 2 then th = th + 2 * pi end -- above and behind: over the top, not round the back
  local al = math.acos(clamp((A1 * A1 + d * d - A2 * A2) / (2 * A1 * d), -1, 1))
  local ga = math.acos(clamp((A1 * A1 + A2 * A2 - d * d) / (2 * A1 * A2), -1, 1))
  return th - al, pi - ga
end
local function units(wx, wy) return (wx - P.x) * P.face / S, (BASE - wy) / S end
local function reachU(which, tu, tv)
  local su, sv = shoulderOf(T)
  local a1, a2 = ik(su, sv, tu, tv)
  if which ~= "f" then T.b1, T.b2 = a1, a2 end
  if which ~= "b" then T.f1, T.f2 = a1, a2 end
end
local function reachW(which, wx, wy) local u, v = units(wx, wy) reachU(which, u, v) end
local function akimbo() local u, v = bodyPt(T, 7, 3) reachU("both", u, v) end
local function brow(which) local u, v = headPt(T, 15, 14) reachU(which, u, v) end

local function pt(x, y) return { floor(x + 0.5), floor(y + 0.5) } end
local HAND = {} -- where his hands are this frame (px): f, b = near and far fingertips; fw, bw = wrists
-- A bowler hat, in units from the middle of its brim (v up): curled brim tips, a round crown, a band.
local BRIM, CROWN, BAND = 19, 12, 3.5
local HATWORN = nil -- while he wears it: how far its brim sits above (+) or below (-) its place on his head
local HEAD = { { -6, 2 }, { -10, 10 }, { -10, 19 }, { -5, 26 }, { 3, 28 }, { 10, 25 }, { 14, 19 }, { 15, 13 } }
local function world(u, v)
  if P.fall ~= 0 then -- toppled about his foot
    local du, c, sn = u - P.pv, cos(P.fall), sin(P.fall)
    u, v = P.pv + du * c - v * sn, du * sn + v * c
  end
  return { I(P.x + u * P.face * S), I(BASE - v * (1 - P.sink) * S) }
end

-- The far arm is behind him: keep only the pieces of it outside his outline (closed along the line).
local function inside(poly, x, y)
  local c, j = false, #poly
  for i = 1, #poly do
    local xi, yi, xj, yj = poly[i][1], poly[i][2], poly[j][1], poly[j][2]
    if (yi > y) ~= (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi then c = not c end
    j = i
  end
  return c
end
local function behind(poly, line)
  local runs, cur = {}, nil
  for k = 1, #line - 1 do
    local ax, ay, bx, by = line[k][1], line[k][2], line[k + 1][1], line[k + 1][2]
    local dx, dy = bx - ax, by - ay
    local ts, j = { 0, 1 }, #poly
    for i = 1, #poly do -- where this bone crosses his outline
      local px, py = poly[j][1], poly[j][2]
      local ex, ey = poly[i][1] - px, poly[i][2] - py
      local den = dx * ey - dy * ex
      if den ~= 0 then
        local t = ((px - ax) * ey - (py - ay) * ex) / den
        local u = ((px - ax) * dy - (py - ay) * dx) / den
        if t > 0 and t < 1 and u >= 0 and u <= 1 then ts[#ts + 1] = t end
      end
      j = i
    end
    table.sort(ts)
    for m = 1, #ts - 1 do
      local t0, t1 = ts[m], ts[m + 1]
      if t1 - t0 > 1e-3 then
        local tm = (t0 + t1) / 2
        if inside(poly, ax + dx * tm, ay + dy * tm) then
          cur = nil
        else
          if not cur then
            cur = { pt(ax + dx * t0, ay + dy * t0) }
            runs[#runs + 1] = cur
          end
          cur[#cur + 1] = pt(ax + dx * t1, ay + dy * t1)
        end
      end
    end
  end
  return runs
end

-- The man as strokes: his outline (heel to toe, back to front), the inner legs, the near arm, and
-- the pieces of the far arm that show.
local function figure()
  local Q = P
  local hu, hv = hipOf(Q)
  local bu, bv, fu, fv = Q.fbu, Q.fbv + Q.hop, Q.ffu, Q.ffv + Q.hop
  if bu > fu then bu, bv, fu, fv = fu, fv, bu, bv end
  local kbu, kbv = knee(hu, hv, bu, bv)
  local kfu, kfv = knee(hu, hv, fu, fv)
  local t, j = 3.5, Q.jaw
  -- Each leg's back-edge normal (its front edge is the other way), so a bent leg keeps its width.
  local function nrm(au, av)
    local dx, dy = au - hu, av - hv
    local d = max(0.01, sqrt(dx * dx + dy * dy))
    return dy / d * t, -dx / d * t
  end
  local nbu, nbv = nrm(bu, bv)
  local nfu, nfv = nrm(fu, fv)
  local out = {}
  local function add(u, v) out[#out + 1] = world(u, v) end
  local function B(u, v) add(bodyPt(Q, u, v)) end
  local function Hd(u, v) add(headPt(Q, u, v)) end
  add(bu - 5, bv) add(kbu + nbu, kbv + nbv)
  B(-t - 3, -1) B(-10, 6) B(-11, 16) B(-9, 28) B(-6, 35)
  -- The top of his head, or his hat: the line runs out along the brim, over the crown and back.
  local bh, hatted = HATWORN and 21 + HATWORN, false
  for _, q in ipairs(HEAD) do
    if bh and q[2] > bh - 0.5 then
      if not hatted then
        hatted = true
        Hd(2 - CROWN, bh) Hd(3.5 - BRIM, bh) Hd(2 - BRIM, bh + 2) Hd(3.5 - BRIM, bh)
        for k = 0, 8 do local a = pi - k * pi / 8 Hd(2 + CROWN * cos(a), bh + CROWN * sin(a)) end
        Hd(BRIM + 0.5, bh) Hd(BRIM + 2, bh + 2) Hd(BRIM + 0.5, bh) Hd(2 + CROWN, bh)
      end
    else
      Hd(q[1], q[2])
    end
  end
  Hd(19, 11) Hd(25, 8) Hd(29, 3) Hd(28, -1) Hd(23, -1) Hd(17, 1)          -- the nose
  Hd(16, -2) Hd(13, -3 - 2 * j) Hd(16, -5 - 5 * j) Hd(15, -9 - 6 * j) Hd(9, -11 - 4 * j) Hd(4, -7) -- mouth, chin
  B(8, 30) B(10, 20) B(13, 10) B(10, 2)
  add(kfu - nfu, kfv - nfv) add(fu - nfu, fv + 3) add(fu + 11, fv)
  local legs = { world(bu - 5, bv), world(bu + 7, bv), world(bu - nbu, bv + 3), world(kbu - nbu, kbv - nbv),
    world(hu + 1, hv - 5), world(kfu + nfu, kfv + nfv), world(fu + nfu, fv + 3), world(fu - 5, fv) }
  local su, sv = shoulderOf(Q)
  local function arm(a1, a2)
    local eu, ev = su + A1 * sin(a1), sv - A1 * cos(a1)
    local a = a1 + a2
    local wu, wv = eu + A2 * sin(a), ev - A2 * cos(a)
    local hl, ha = 6 + 12 * Q.needles, a + 0.35 * (1 - Q.needles)
    return world(eu, ev), world(wu, wv), world(wu + hl * sin(ha), wv - hl * cos(ha))
  end
  local be, bw, bt = arm(Q.b1, Q.b2)
  local fe, fw, ft = arm(Q.f1, Q.f2)
  local sh = world(su, sv)
  HAND.f, HAND.fw, HAND.b, HAND.bw = ft, fw, bt, bw
  local near = { sh, fe, fw, ft }
  local far = behind(out, { sh, be, bw, bt })
  if Q.face < 0 then -- keep the outline left to right, so the line runs into it from the left
    local r = {}
    for i = #out, 1, -1 do r[#r + 1] = out[i] end
    out = r
  end
  return out, legs, near, far
end

-- ── the line ────────────────────────────────────────────────────────────────

local rip = nil -- a ripple running along the line: { c, t, a }
local function ripple(c, a) rip = { c = c, t = 0, a = a } end
local function ripAt(x)
  local d, r = abs(x - rip.c), rip.t * 150 * S
  return rip.a * S * (1 - rip.t / 1.4) * exp(-((d - r) / (16 * S)) ^ 2) * cos((d - r) / (5 * S))
end
local function gpt(x) return pt(x, BASE + (rip and ripAt(x) or 0)) end
local function flat(pts, xa, xb) -- the line from xa (already there) to xb
  if rip then
    local x = xa + 8
    while x < xb do pts[#pts + 1] = pt(x, BASE + ripAt(x)) x = x + 8 end
    pts[#pts + 1] = pt(xb, BASE + ripAt(xb))
  else
    pts[#pts + 1] = pt(xb, BASE)
  end
end

-- Features of the line, one at a time: a gap, a tent he lifts, the snap, the knitting.
local function gapF(c) return { k = "gap", c = c, w = GAP + TAIL } end
local function tentF(c, hx, hy, w) return { k = "tent", c = c, w = w or GAP + TAIL, hx = hx, hy = hy } end
local function feature(pts, F, b)
  local c = F.c
  if F.k == "tent" then
    pts[#pts + 1] = pt(F.hx, F.hy)
  elseif F.k == "gap" or F.k == "pull" then
    local lx, ly, rx, ry = c - GAP, BASE + DROOP, c + GAP, BASE + DROOP
    if F.k == "pull" then -- the ends fly from his hands to hang either side of the break
      local e = 1 - (1 - F.s) ^ 3
      local wob = sin(F.s * 9) * (1 - F.s) * 4 * S
      lx, ly = lerp(F.hx, lx, e), lerp(F.hy, ly, e) + wob
      rx, ry = lerp(F.hx, rx, e), lerp(F.hy, ry, e) - wob
    end
    pts[#pts + 1] = pt(lx, ly)
    pts[#pts + 1] = pt(lx + 2 * S, ly + 3 * S)
    pts[#pts + 1] = false
    pts[#pts + 1] = pt(rx - 2 * S, ry + 3 * S)
    pts[#pts + 1] = pt(rx, ry)
  elseif F.k == "hump" then -- something moving under the line
    for k = 1, 7 do
      local q = k / 8
      pts[#pts + 1] = pt(c - F.w + 2 * F.w * q, BASE - F.hy * sin(q * pi) ^ 2)
    end
  elseif F.k == "knit" then -- stitches grow in from both ends; amp flattens them once they meet
    local lx, rx, dy = c - GAP, c + GAP, BASE + F.droop
    local step = max(3, 3 * S)
    local n = max(2, floor(2 * GAP / step))
    local done = floor(F.p * n / 2 + 0.5)
    local function zig(k) return pt(lx + k * (rx - lx) / n, BASE + (k % 2 == 0 and F.amp or -F.amp)) end
    pts[#pts + 1] = pt(lx, dy)
    if F.p >= 1 then
      for k = 1, n - 1 do pts[#pts + 1] = zig(k) end
    else
      for k = 1, min(done, n - 1) do pts[#pts + 1] = zig(k) end
      pts[#pts + 1] = false
      for k = max(n - done, 1), n - 1 do pts[#pts + 1] = zig(k) end
    end
    pts[#pts + 1] = pt(rx, dy)
  end
  pts[#pts + 1] = pt(b, BASE)
end
local function ground(pts, xa, xb, feats) -- feats: left to right, apart from each other
  local x = xa
  for _, F in ipairs(feats) do
    if F.c > xa and F.c < xb then
      local a, b = max(F.c - F.w, x + 1), min(F.c + F.w, xb - 1)
      flat(pts, x, a)
      feature(pts, F, b)
      x = b
    end
  end
  flat(pts, x, xb)
end

-- ── what he does ────────────────────────────────────────────────────────────
-- An action is a step(a, u, t) run each frame for dur seconds (u: 0..1). Steps set the pose he
-- moves towards (T), and the line's feature for the frame (feat).

local feat = nil
local drawProps = nil -- set by a step: returns the props' polylines once he's drawn ({ ..., behind = true } hides behind him)
local act, plan = nil, {}
local idleAt, lastIdle = 2, nil
local drag = nil -- { x, y, from, moved } while a finger is down
local holdDir, holding = -1, false

local function A(dur, step, opt)
  local a = opt or {}
  a.dur, a.step, a.t = dur, step, 0
  return a
end
local function turnTo(f) return A(0.12, function() P.face = f rest() end) end
local function pause(d) return A(d, function() rest() end) end

-- Walk to x: legs cycle with the distance covered, so the standing foot doesn't slide.
local function walk(tx, speed)
  return A(1, function(a, u)
    if not a.x0 then
      a.x0 = P.x
      a.dur = abs(tx - a.x0) / speed + 0.01
      if tx ~= a.x0 then P.face = tx > a.x0 and 1 or -1 end
    end
    rest()
    P.x = lerp(a.x0, tx, u)
    local ph = abs(P.x - a.x0) / S / 9
    local sf = min(1, u * 8, (1 - u) * 8) -- ease into and out of the stride
    T.fbu, T.fbv = -9 * sin(ph) * sf, max(0, -cos(ph)) * 5 * sf
    T.ffu, T.ffv = 9 * sin(ph) * sf, max(0, cos(ph)) * 5 * sf
    if abs(T.fbu - T.ffu) < 6 then T.fbu, T.ffu = T.fbu - 3, T.ffu + 3 end
    T.sq = 0.05 + 0.04 * abs(cos(ph))
    T.lean = 0.08 + speed / S / 1200
    T.f1, T.b1 = 0.1 - 0.5 * sin(ph) * sf, 0.1 + 0.5 * sin(ph) * sf
  end, { k = 0.04 })
end

-- Off: he bends, takes the line, heaves it up until it snaps; the ends fly apart and the light dies.
local function planOff()
  local f = P.face
  if P.x + f * REACH > XMAX or P.x + f * REACH < XMIN then f = -f end
  local G = P.x + f * REACH
  local top = BASE - 46 * S
  return {
    turnTo(f),
    A(0.45, function(a, u)
      rest()
      local e = ease(u)
      T.lean, T.sq, T.nod, T.ffu = 1.0 * e, 0.6 * e, 0.3 * e, lerp(7, 11, e)
      reachW("both", G, BASE)
      feat = tentF(G, G, BASE)
    end, { light = true }),
    A(0.75, function(a, u)
      rest()
      local e = ease(u)
      local hy = lerp(BASE, top, e)
      T.lean, T.sq, T.nod = lerp(1.0, -0.1, e), lerp(0.6, 0.12, e), lerp(0.3, -0.25, e)
      T.fbu, T.ffu = lerp(-7, -12, e), lerp(11, 7, e)
      reachW("both", G, hy)
      if u > 0.8 then reachW("both", G + sin(clock * 60) * S, hy) end -- the strain
      feat = tentF(G, G, hy)
    end, { light = true }),
    A(0.6, function(a, u)
      if not a.snapped then
        a.snapped, visOn, gapC, lit = true, false, G, 0.35
        ripple(G, 7)
      end
      rest()
      local b = bell(u)
      T.lean, T.jaw, T.fbu = -0.45 * b, 0.9 * b, -12
      T.f1, T.f2, T.b1, T.b2 = lerp(2.7, 0.3, ease(u)), 0.2, lerp(2.3, -0.1, ease(u)), 0.4
      feat = { k = "pull", c = G, w = GAP + TAIL, hx = G, hy = top, s = u }
    end, { light = true, k = 0.05 }),
    A(0.9, function(a, u, t) -- dusts off his hands
      rest()
      T.nod = 0.25
      T.f1, T.f2 = 1.0, 0.9 + 0.35 * sin(t * 22)
      T.b1, T.b2 = 1.1, 0.9 - 0.35 * sin(t * 22)
    end, { light = true }),
  }
end

-- On: he goes to the break, gets out his needles and knits the ends together; the lamp catches.
local function planOn()
  local G = gapC or (P.x + P.face * REACH)
  local f = P.x <= G and 1 or -1
  local X = clamp(G - f * REACH, XMIN, XMAX)
  local hands = BASE - 18 * S
  return {
    walk(X, 110 * S),
    turnTo(f),
    A(0.4, function(a, u)
      rest()
      local e = ease(u)
      T.lean, T.sq, T.nod = 0.6 * e, 0.35 * e, 0.4 * e
      reachW("both", G - f * GAP, BASE + DROOP)
    end, { light = true }),
    A(1.8, function(a, u, t)
      rest()
      T.lean, T.sq, T.nod, T.needles = 0.6, 0.35, 0.45, 1
      reachW("f", G - f * 2 * S + sin(t * 24) * 3 * S, hands + cos(t * 24) * 2 * S)
      reachW("b", G - f * 6 * S - sin(t * 24) * 3 * S, hands + 2 * S - cos(t * 24) * 2 * S)
      T.jaw = 0.15 + 0.15 * sin(t * 7) -- tongue out, concentrating
      feat = { k = "knit", c = G, w = GAP + TAIL, p = u, amp = 3 * S, droop = DROOP * (1 - ease(u * 6)) }
    end, { light = true }),
    A(0.4, function(a, u)
      rest()
      T.lean, T.sq, T.nod = 0.6 * (1 - u), 0.35 * (1 - u), 0.45 * (1 - u)
      feat = { k = "knit", c = G, w = GAP + TAIL, p = 1, amp = 3 * S * (1 - ease(u)), droop = 0 }
    end, { light = true }),
    A(1.1, function(a, u)
      if not a.caught then a.caught, visOn, gapC = true, true, nil end
      rest()
      flicker = u < 0.07 and 0.9 or u < 0.14 and 0.05 or u < 0.2 and 1 or u < 0.3 and 0.15 or ease(seg(u, 0.3, 0.8))
      if u >= 1 then flicker = nil end
      T.lean, T.nod = -0.12, -0.12
      akimbo()
    end, { light = true }),
  }
end

-- Dimming: he holds the line up; the higher he lifts it, the brighter. Drag or hold A.
local function dimAct()
  local f = P.face
  if P.x + f * REACH > XMAX or P.x + f * REACH < XMIN then f = -f end
  P.face = f
  local D = P.x + f * REACH
  if gapC then ripple(gapC, 5) end
  visOn, gapC, flicker = true, nil, nil
  return A(1e9, function(a, u, t)
    rest()
    local e = level / 100
    local hy = BASE - (3 + 50 * e) * S
    T.lean, T.sq, T.nod = lerp(1.0, 0.15, e), lerp(0.55, 0, e), lerp(0.35, -0.15, e)
    T.fbu = lerp(-7, -10, e)
    reachW("both", D, hy)
    feat = tentF(D, D, hy, 20 * S)
    a.hy = hy
    pct:set { text = I(level) .. "%", text_opa = 255, x = I(D + (f > 0 and 8 or -30) * S), y = I(hy - 22 * S) }
  end, { light = true, dim = true, D = D })
end
local function letGo(D, hy)
  return A(0.6, function(a, u)
    if not a.rippled then a.rippled = true ripple(D, 4) end
    rest()
    feat = tentF(D, D, lerp(hy, BASE, 1 - (1 - u) ^ 3), 20 * S)
    pct:set { text_opa = I(255 * (1 - u)) }
  end, { light = true })
end

-- ── idle: what he gets up to while nobody needs the light ───────────────────

local function side() -- the stretch of line he can walk on (not across the break)
  if not gapC then return XMIN, XMAX end
  if P.x < gapC then return XMIN, min(XMAX, gapC - REACH) end
  return max(XMIN, gapC + REACH), XMAX
end
local function spot(minD)
  local a, b = side()
  for _ = 1, 6 do
    local x = lerp(a, b, random())
    if abs(x - P.x) >= minD then return x end
  end
  return clamp(P.x, a, b)
end
local function headW(u, v) return world(headPt(P, u, v)) end
local function label(o, x, y, opa) o:set { x = I(x), y = I(y), text_opa = I(255 * clamp(opa, 0, 1)) } end

local IDLES = {
  stroll = function()
    return { walk(spot(40 * S), 38 * S), pause(0.6 + random()), random() < 0.5 and turnTo(-P.face) or pause(0.2) }
  end,
  look = function()
    local f = P.face
    return { A(3, function(a, u)
      rest()
      P.face = (u > 0.3 and u < 0.68) and -f or f
      T.lean, T.nod = 0.15, -0.05
      if u > 0.1 and u < 0.9 then brow("f") end
    end) }
  end,
  tapfoot = function()
    return { A(2.8, function(a, u, t)
      rest()
      akimbo()
      T.ffv, T.nod, T.lean = max(0, sin(t * 15)) * 3, 0.05, -0.05
    end) }
  end,
  yawn = function()
    return { A(3, function(a, u)
      rest()
      local e = bell(u)
      T.f1, T.f2, T.b1, T.b2 = lerp(0.12, 2.9, e), 0.3 * e, lerp(-0.08, 2.75, e), 0.4 * e
      T.lean, T.nod, T.jaw = -0.25 * e, -0.55 * e, bell(seg(u, 0.15, 0.75))
      T.hop = 2 * bell(seg(u, 0.3, 0.6))
    end) }
  end,
  sit = function()
    local function sitting(e)
      T.sq, T.ffu, T.fbu, T.lean = e, lerp(7, 15, e), lerp(-7, 8, e), 0.15 * e
    end
    return {
      A(0.9, function(a, u) rest() sitting(ease(u)) end),
      A(4 + 2 * random(), function(a, u, t)
        rest()
        sitting(1)
        T.ffv, T.ffu = max(0, sin(t * 4)) * 4, 16 + sin(t * 4) * 3
        local ku, kv = knee(0, 13, 16, 0)
        reachU("both", ku + 3, kv + 2)
        T.nod = 0.15 + 0.1 * sin(t * 0.9)
      end),
      A(0.8, function(a, u) rest() sitting(1 - ease(u)) end),
    }
  end,
  wave = function()
    return { A(2.4, function(a, u, t)
      rest()
      local e = ease(seg(u, 0, 0.2)) * (1 - ease(seg(u, 0.8, 1)))
      T.f1, T.f2 = lerp(0.12, 2.5, e), lerp(0.2, 0.3 + 0.55 * sin(t * 13), e)
      T.jaw, T.nod = 0.35 * e, -0.1 * e
    end) }
  end,
  watch = function()
    return { A(3, function(a, u)
      rest()
      local e = ease(seg(u, 0, 0.15)) * (1 - ease(seg(u, 0.6, 0.7)))
      local sh = bell(seg(u, 0.68, 1))
      T.b1, T.b2 = lerp(-0.08, 0.55, e), lerp(0.15, 1.75, e)
      T.nod = 0.5 * e - 0.1 * sh
      T.f1, T.f2 = lerp(T.f1, 0.25, sh), lerp(T.f2, 1.5, sh)
      if sh > 0 then T.b1, T.b2 = 0.15 * sh, 1.4 * sh end
      T.hop = 1.5 * sh
    end) }
  end,
  sleep = function() -- sits down and nods off
    local function sitting(e) T.sq, T.ffu, T.fbu, T.lean = e, lerp(7, 15, e), lerp(-7, 8, e), 0.15 * e end
    return {
      A(1.3, function(a, u) rest() sitting(ease(u)) T.nod = 0.7 * ease(seg(u, 0.5, 1)) end),
      A(5 + 2 * random(), function(a, u, t)
        rest()
        sitting(1)
        T.lean, T.nod = 0.3 + 0.03 * sin(t * 2), 0.75 + 0.05 * sin(t * 2)
        local ku, kv = knee(0, 13, 16, 0)
        reachU("both", ku + 2, kv + 3)
        local hx, hy = table.unpack(headW(10, 20))
        for i = 1, 3 do
          local k = (t * 0.45 + (i - 1) / 3) % 1
          label(zs[i], hx + P.face * k * 30 * S, hy - 10 * S - k * 50 * S, bell(k))
        end
      end, { done = function() for i = 1, 3 do zs[i]:set { text_opa = 0 } end end }),
      A(0.7, function(a, u)
        rest()
        sitting(1 - ease(u))
        T.hop, T.jaw = 10 * bell(u), 0.6 * bell(u)
        local hx, hy = table.unpack(headW(4, 24))
        label(bang, hx, hy - 30 * S, bell(u))
      end),
    }
  end,
  dive = function()
    local x = spot(60 * S)
    return {
      A(0.5, function(a, u) rest() T.sq, T.lean = 0.45 * ease(u), 0.3 * ease(u) end),
      A(0.6, function(a, u) rest() T.sq, T.lean, T.sink = 0.45, 0.3, ease(u) end, { k = 0.03 }),
      A(abs(x - P.x) / (120 * S) + 0.2, function(a, u)
        a.x0 = a.x0 or P.x
        rest()
        P.x = lerp(a.x0, x, ease(u))
        T.sink, T.sq = 1, 0.45
        feat = { k = "hump", c = P.x, w = 12 * S, hy = 7 * S * clamp(min(u, 1 - u) / 0.15, 0, 1) }
      end, { k = 0.03 }),
      A(0.7, function(a, u)
        if not a.rippled then a.rippled = true ripple(P.x, 5) end
        rest()
        T.sink, T.hop = 1 - ease(seg(u, 0, 0.5)), 14 * bell(seg(u, 0.25, 1))
        T.f1, T.b1 = 2.6 * bell(u), 2.4 * bell(u)
      end, { k = 0.03 }),
    }
  end,
  dance = function()
    local f = P.face
    return { A(3.6, function(a, u, t)
      rest()
      local b = t * 2 * pi * 2
      if u > 0.5 then P.face = -f end
      T.hop, T.sq = max(0, sin(b)) * 4, 0.12 + 0.08 * sin(b * 2)
      T.ffv, T.fbv = max(0, sin(b)) * 5, max(0, -sin(b)) * 5
      T.f1, T.b1, T.f2, T.b2 = 1.6 + 1.1 * sin(b), 1.6 - 1.1 * sin(b), 0.6, 0.6
      T.nod, T.jaw = 0.15 * sin(b), 0.3
    end, { k = 0.04 }) }
  end,
  grumble = function()
    return { A(3, function(a, u, t)
      rest()
      T.lean, T.nod = 0.25, 0.1
      T.f1, T.f2 = 1.4 + 0.9 * sin(t * 13), 0.6 + 0.4 * sin(t * 9)
      T.b1, T.b2 = 1.0 + 0.8 * sin(t * 11 + 1), 0.8
      T.jaw = clamp(0.5 + 0.6 * sin(t * 25), 0, 1)
      if not a.next or t >= a.next then -- his garbled words, redrawn a few times a second
        a.next = t + 0.12
        local nx, ny = table.unpack(headW(28, 12))
        local pts = {}
        for i = 0, 6 do pts[#pts + 1] = { I(nx + P.face * i * 4 * S), I(ny - 8 * S + (random() - 0.5) * 10 * S) } end
        scribble:set { points = pts }
        scribble:clear_flag(HIDDEN)
      end
    end, { done = function() scribble:add_flag(HIDDEN) end }) }
  end,
  hop = function()
    return { A(1.4, function(a, u)
      rest()
      T.sq = 0.4 * bell(seg(u, 0, 0.3)) + 0.35 * bell(seg(u, 0.75, 1))
      T.hop = 20 * bell(seg(u, 0.25, 0.75))
      T.f1, T.b1 = 2.6 * bell(seg(u, 0.2, 0.8)), 2.4 * bell(seg(u, 0.2, 0.8))
      if u >= 0.75 and not a.landed then a.landed = true ripple(P.x, 6) end
    end, { k = 0.04 }) }
  end,
  balance = function()
    return { A(3.4, function(a, u, t)
      rest()
      local e = ease(seg(u, 0, 0.15)) * (1 - ease(seg(u, 0.85, 1)))
      T.ffu, T.ffv = lerp(7, 14, e), 9 * e
      T.fbu = lerp(-7, -1, e)
      T.f1, T.f2, T.b1, T.b2 = lerp(0.12, 1.7, e), 0, lerp(-0.08, -1.6, e), 0
      T.lean = e * (0.12 * sin(t * 3.1) + 0.06 * sin(t * 7.3))
    end) }
  end,
  peer = function() -- into the break, wondering where the light went
    if not gapC then return { pause(0.5) } end
    local f = P.x < gapC and 1 or -1
    return {
      walk(clamp(gapC - f * REACH * 0.9, XMIN, XMAX), 38 * S), turnTo(f),
      A(3, function(a, u, t)
        rest()
        local e = ease(seg(u, 0, 0.2)) * (1 - ease(seg(u, 0.85, 1)))
        T.lean, T.sq, T.nod = 0.7 * e, 0.25 * e, 0.5 * e + 0.25 * e * sin(t * 6) * (u > 0.55 and 1 or 0)
        brow("f")
      end),
    }
  end,
  -- Poses: most ease in over the first fifth and out over the last (inOut).
  scratch = function() -- scratches the back of his head, puzzled
    return { A(2.6, function(a, u, t)
      rest()
      local e = inOut(u)
      reachU("f", headPt(T, -2 + 3 * sin(t * 28) * e, 24))
      T.f1, T.f2 = lerp(0.12, T.f1, e), lerp(0.2, T.f2, e)
      T.nod, T.jaw, T.lean = 0.2 * e, 0.15 * e, 0.05 * e
    end) }
  end,
  crossed = function() -- arms folded, shifting his weight from foot to foot
    return { A(4, function(a, u, t)
      rest()
      local e = inOut(u)
      local w = sin(t * 1.6) * e
      reachU("f", bodyPt(T, 11, 25))
      reachU("b", bodyPt(T, 9, 28))
      if e < 1 then T.f1, T.b1 = lerp(0.12, T.f1, e), lerp(-0.08, T.b1, e) end
      T.lean, T.fbu, T.ffu, T.nod = -0.06 * e + 0.05 * w, -7 + 2 * w, 7 + 2 * w, -0.1 * e
    end) }
  end,
  heels = function() -- hands behind his back, rocking on his heels
    return { A(3.4, function(a, u, t)
      rest()
      local e = inOut(u)
      local r = sin(t * 4) * e
      reachU("both", bodyPt(T, -13, 10))
      if e < 1 then T.f1, T.b1 = lerp(0.12, T.f1, e), lerp(-0.08, T.b1, e) end
      T.lean, T.hop, T.nod = 0.1 * r, 1.5 * max(0, r), -0.15 * e
      T.ffv = 3 * max(0, -r)
    end) }
  end,
  bow = function() -- a deep, theatrical bow
    return { A(2.6, function(a, u)
      rest()
      local e = bell(seg(u, 0.1, 0.9))
      T.lean, T.nod, T.sq = 1.15 * e, 0.3 * e, 0.1 * e
      reachU("f", bodyPt(T, 11, 14))
      T.f1, T.f2 = lerp(0.12, T.f1, e), lerp(0.2, T.f2, e)
      T.b1, T.b2 = lerp(-0.08, -1.3, e), 0.3 * e
      T.fbu = lerp(-7, -12, e)
    end) }
  end,
  tiptoe = function() -- sneaks off somewhere, hunched, on the tips of his toes
    local w = walk(spot(30 * S), 16 * S)
    local step = w.step
    w.step = function(a, u, t)
      step(a, u, t)
      local e = clamp(min(u, 1 - u) * 6, 0, 1)
      T.hop, T.lean, T.nod = 2 * e, 0.4 * e, -0.15 * e
      T.ffv, T.fbv = T.ffv * 1.8, T.fbv * 1.8
      T.f1, T.f2 = lerp(T.f1, 1.0, e), lerp(T.f2, 1.7, e)
      T.b1, T.b2 = lerp(T.b1, 0.85, e), lerp(T.b2, 1.8, e)
    end
    return { w, pause(0.4) }
  end,
  shakelegs = function() -- shakes out one leg, then the other
    return { A(3, function(a, u, t)
      rest()
      local front = u < 0.5
      local e = bell(seg(u, front and 0 or 0.5, front and 0.5 or 1))
      local j = sin(t * 34) * e
      if front then T.ffu, T.ffv = 9 + 3 * j, 7 * e + 2 * j else T.fbu, T.fbv = -9 + 3 * j, 7 * e + 2 * j end
      T.f1, T.b1 = 0.12 + 0.6 * e, -0.08 - 0.6 * e
      T.lean = (front and -0.08 or 0.08) * e
    end) }
  end,
  lookup = function() -- leans back to stare at the ceiling (is that where the light comes from?)
    return { A(3.4, function(a, u, t)
      rest()
      local e = inOut(u)
      T.lean, T.nod, T.jaw = -0.3 * e, -0.75 * e, 0.3 * e * (0.8 + 0.2 * sin(t * 3))
      akimbo()
      T.f1, T.f2, T.b1, T.b2 = lerp(0.12, T.f1, e), lerp(0.2, T.f2, e), lerp(-0.08, T.b1, e), lerp(0.15, T.b2, e)
      T.fbu = lerp(-7, -10, e)
    end) }
  end,
  shoo = function() -- shoos something away
    return { A(2.4, function(a, u, t)
      rest()
      local e = inOut(u)
      T.lean, T.nod, T.jaw = 0.25 * e, 0.1 * e, 0.35 * e * max(0, sin(t * 10))
      T.f1, T.f2 = lerp(0.12, 1.25 + 0.6 * sin(t * 14), e), lerp(0.2, 0.25, e)
      reachU("b", bodyPt(T, 7, 3))
      T.b1, T.b2 = lerp(-0.08, T.b1, e), lerp(0.15, T.b2, e)
    end) }
  end,
  runspot = function() -- a slow-motion sprint that goes nowhere
    return { A(3.4, function(a, u, t)
      rest()
      local e = inOut(u)
      local ph = t * 2.4
      local s1 = sin(ph) * e
      T.ffu, T.ffv = 4 + 7 * s1, max(0, s1) * 13
      T.fbu, T.fbv = -4 - 7 * s1, max(0, -s1) * 13
      T.f1, T.f2, T.b1, T.b2 = 1.0 * s1, 1.5 * e, -1.0 * s1, 1.5 * e
      T.lean, T.hop, T.jaw, T.nod = 0.2 * e, 3 * abs(s1), 0.2 * e, -0.1 * e
    end, { k = 0.05 }) }
  end,
  sigh = function() -- breathes in, then sags all over
    return { A(3.8, function(a, u)
      rest()
      local up, down = bell(seg(u, 0, 0.35)), ease(seg(u, 0.3, 0.45)) * (1 - ease(seg(u, 0.8, 1)))
      T.lean, T.nod, T.jaw = -0.15 * up + 0.3 * down, -0.35 * up + 0.7 * down, 0.3 * up + 0.15 * down
      T.hop, T.sq = 1.5 * up, 0.25 * down
      T.f1, T.b1 = 0.12 + 0.35 * down, -0.08 + 0.4 * down
      T.f2, T.b2 = 0.2 + 0.4 * up, 0.15 + 0.4 * up
    end) }
  end,
  ponder = function() -- chin in hand, thinking it over
    return { A(4, function(a, u, t)
      rest()
      local e = inOut(u)
      reachU("f", headPt(T, 11, -11))
      reachU("b", bodyPt(T, 10, 18))
      T.f1, T.f2 = lerp(0.12, T.f1, e), lerp(0.2, T.f2, e)
      T.b1, T.b2 = lerp(-0.08, T.b1, e), lerp(0.15, T.b2, e)
      T.nod, T.lean = (0.15 + 0.08 * sin(t * 1.3)) * e, 0.08 * e
      T.ffv = u > 0.5 and max(0, sin(t * 6)) * 2 * e or 0
    end) }
  end,
  kick = function() -- kicks a pebble down the line and watches it bounce away
    return { A(2.8, function(a, u)
      rest()
      local wind, strike = bell(seg(u, 0, 0.25)), bell(seg(u, 0.22, 0.42))
      T.ffu, T.ffv = 7 - 12 * wind + 22 * strike, 5 * wind + 15 * strike
      T.lean, T.f1, T.b1 = 0.15 * wind - 0.2 * strike, 0.12 - 0.6 * strike, -0.08 + 0.7 * strike
      if u > 0.38 and not a.kicked then a.kicked = true ripple(P.x + P.face * 60 * S, 4) end
      local watch = ease(seg(u, 0.4, 0.55)) * (1 - ease(seg(u, 0.9, 1)))
      T.nod, T.jaw = 0.1 * watch, 0.2 * watch
      if watch > 0 then brow("f") T.f1, T.f2 = lerp(0.12, T.f1, watch), lerp(0.2, T.f2, watch) end
    end) }
  end,
}
-- ── props: things he plays with ─────────────────────────────────────────────
-- Each is a plan whose steps set drawProps; positions are in px unless a helper says units.

local function at(ox, f, u, v) return pt(ox + u * f * S, BASE - v * S) end -- units from a fixed spot
local function W2(u, v) local q = world(u, v) return q[1], q[2] end    -- units in his frame → px
local function oval(cx, cy, rx, ry, n)
  local p = {}
  for k = 0, n do local a = k * 2 * pi / n p[#p + 1] = pt(cx + cos(a) * rx, cy + sin(a) * ry) end
  return p
end
-- Shape points (units, v up) turned by ang, scaled, mirrored to his facing, placed at px (cx, cy).
local function place(shape, cx, cy, ang, sc, f)
  local c, sn, p = cos(ang), sin(ang), {}
  for i = 1, #shape do
    local u, v = shape[i][1], shape[i][2]
    p[i] = pt(cx + f * (u * c - v * sn) * S * sc, cy - (u * sn + v * c) * S * sc)
  end
  return p
end

-- The line grows a chair behind him; he sits, feet up, hands folded on his belly.
function IDLES.chair()
  local ox, f, g = P.x, P.face, 0
  local function draw()
    if g < 0.03 then return nil end
    local function c(u, v) return at(ox, f, u, v * g) end
    return { { c(-19, 50), c(-16, 21), c(7, 21), c(7, 0), behind = true }, { c(-16, 21), c(-17, 0), behind = true } }
  end
  local function sitting(e) T.sq, T.ffu, T.fbu, T.lean = 0.57 * e, lerp(7, 15, e), lerp(-7, 10, e), -0.12 * e end
  return {
    A(1.2, function(a, u)
      rest()
      g = ease(u)
      T.nod, T.jaw = 0.35 * bell(u), 0.3 * bell(u) -- looks down at it, surprised
      drawProps = draw
    end),
    A(0.8, function(a, u) rest() sitting(ease(u)) drawProps = draw end),
    A(5 + 2 * random(), function(a, u, t)
      rest()
      sitting(1)
      local e = ease(seg(u, 0, 0.1)) * (1 - ease(seg(u, 0.92, 1)))
      T.ffu, T.ffv = lerp(15, 21 + 2 * sin(t * 2.5), e), (8 + 2 * sin(t * 2.5)) * e
      reachU("both", bodyPt(T, 13, 12)) -- hands folded on his belly
      T.f1, T.f2, T.b1, T.b2 = lerp(0.12, T.f1, e), lerp(0.2, T.f2, e), lerp(-0.08, T.b1, e), lerp(0.15, T.b2, e)
      T.nod = (0.1 + 0.06 * sin(t * 0.8)) * e
      drawProps = draw
    end),
    A(0.8, function(a, u) rest() sitting(1 - ease(u)) drawProps = draw end),
    A(0.9, function(a, u)
      if not a.r then a.r = true ripple(ox, 3) end
      rest()
      g = 1 - ease(u)
      drawProps = draw
    end),
  }
end

-- A flower grows out of the line; he goes and picks it, smells it, sneezes its petals off.
function IDLES.flower()
  local lo, hi = side()
  local f = P.face
  if P.x + f * 70 * S > hi + 20 * S or P.x + f * 70 * S < lo - 20 * S then f = -f end
  local fx = clamp(P.x + f * 70 * S, lo + 26 * S, hi + 20 * S)
  if gapC then fx = P.x < gapC and min(fx, gapC - GAP - TAIL - 8 * S) or max(fx, gapC + GAP + TAIL + 8 * S) end
  f = fx >= P.x and 1 or -1
  local L, grow, petals, held, drop, puffs = 24, 0, 1, false, nil, nil
  local function draw()
    local bx, by
    if held then bx, by = HAND.f[1], HAND.f[2] elseif drop then bx, by = drop[1], drop[2] else bx, by = fx, BASE end
    local tx, ty = bx + f * 3 * S * grow, by - L * S * grow
    local items = { { pt(bx, by), pt((bx + tx) / 2 - f * 1.5 * S, (by + ty) / 2), pt(tx, ty) } }
    if petals > 0 and grow > 0.05 then -- five petals round the top of the stem
      local r, p = 7 * S * grow * petals, {}
      for k = 0, 10 do
        local ang, rr = k * pi / 5 - pi / 2, k % 2 == 0 and r or r * 0.4
        p[#p + 1] = pt(tx + cos(ang) * rr, ty - r * 0.7 + sin(ang) * rr)
      end
      items[2] = p
    end
    for _, q in ipairs(puffs or {}) do items[#items + 1] = { pt(q[1], q[2]), pt(q[1] + q[3], q[2] + q[4]) } end
    return items
  end
  return {
    A(1.4, function(a, u)
      rest()
      P.face = f
      grow = ease(u)
      T.jaw, T.hop, T.nod = 0.4 * bell(seg(u, 0.4, 1)), 3 * bell(seg(u, 0.6, 0.9)), 0.15
      drawProps = draw
    end),
    (function() local w = walk(fx - f * 30 * S, 45 * S) local st = w.step w.step = function(a, u, t) st(a, u, t) drawProps = draw end return w end)(),
    A(0.15, function() P.face = f rest() drawProps = draw end),
    A(0.7, function(a, u)
      rest()
      local e = ease(u)
      T.lean, T.sq, T.nod = 0.95 * e, 0.45 * e, 0.4 * e
      reachW("f", fx, BASE - 4 * S)
      drawProps = draw
    end),
    A(1.0, function(a, u)
      if not a.picked then a.picked, held = true, true ripple(fx, 2) end
      rest()
      local e = ease(u)
      T.lean, T.sq, T.nod = 0.95 * (1 - e), 0.45 * (1 - e), 0.4 * (1 - e)
      local nu, nv = headPt(T, 27, 4)
      reachU("f", lerp(26, nu, e), lerp(4, nv - L - 6, e))
      drawProps = draw
    end),
    A(1.6, function(a, u, t) -- breathes it in
      rest()
      local e = bell(u)
      T.lean, T.nod, T.hop, T.jaw = -0.12 * e, -0.25 * e, 2 * e, 0.15
      reachU("b", bodyPt(T, 7, 3)) -- other hand on his hip
      local nu, nv = headPt(T, 27, 4)
      reachU("f", nu, nv - L - 6)
      drawProps = draw
    end),
    A(1.1, function(a, u, t) -- ah... choo!
      rest()
      local snap = u > 0.45
      T.nod, T.lean, T.jaw = snap and 0.5 or -0.55 * ease(u / 0.45), snap and 0.35 or -0.1, snap and 0.1 or 0.9 * ease(u / 0.45)
      local nu, nv = headPt(T, 27, 4)
      reachU("f", nu + 4, nv - L - 4)
      if snap and not puffs then -- the petals fly off
        petals = 0
        local tx, ty = HAND.f[1] + f * 3 * S, HAND.f[2] - L * S
        puffs, a.p0 = {}, {}
        for k = 1, 5 do a.p0[k] = { tx, ty, f * (40 + 30 * k) * S, -(20 + 15 * ((k * 7) % 5)) * S } end
      end
      if puffs then
        local dt = (u - 0.45) * a.dur
        for k, q in ipairs(a.p0) do
          local x, y = q[1] + q[3] * dt, min(BASE - 1, q[2] + q[4] * dt + 120 * S * dt * dt)
          puffs[k] = { x, y, f * 2 * S, -1.5 * S }
        end
      end
      drawProps = draw
    end),
    A(1.3, function(a, u) -- stares at the bare stem, shrugs
      rest()
      puffs = nil
      reachU("f", bodyPt(T, 18, 22))
      local sh = bell(seg(u, 0.6, 1))
      T.nod, T.hop, T.b1, T.b2 = 0.35 * (1 - sh), 1.5 * sh, 0.2 * sh, 1.3 * sh
      drawProps = draw
    end),
    A(1.0, function(a, u) -- drops it; it sinks into the line
      if not a.go then a.go, held = true, false drop = { HAND.f[1], HAND.f[2] } a.y0 = HAND.f[2] end
      rest()
      drop[2] = min(BASE, a.y0 + 400 * S * (u * a.dur) ^ 2)
      if drop[2] >= BASE then grow = max(0, 1 - (u - 0.4) * 2.5) end
      drawProps = draw
    end),
  }
end

-- A ball rolls in; he traps it, flicks it up, heads it three times and boots it away.
function IDLES.ball()
  local f = P.face
  local R = 6 * S
  local toe = P.x + f * 19 * S
  local x0 = f > 0 and W + 2 * R or -2 * R
  local bx, by, spin = x0, BASE - R, 0
  local function draw()
    local c, sn = cos(spin) * R * 0.75, sin(spin) * R * 0.75
    return { oval(bx, by, R, R, 12), { pt(bx - c, by - sn), pt(bx + c, by + sn) } }
  end
  local function head() return W2(headPt(P, 4, 29)) end
  return {
    A(2.0, function(a, u)
      rest()
      bx = lerp(x0, toe, 1 - (1 - u) ^ 2)
      spin = -(bx - x0) / R
      T.nod, T.lean = 0.3 * ease(seg(u, 0.4, 1)), 0.1 * ease(seg(u, 0.4, 1))
      drawProps = draw
    end),
    A(0.5, function(a, u) -- foot on the ball
      rest()
      T.ffu, T.ffv, T.nod = lerp(7, 15, ease(u)), 2 * R / S * bell(u) + 4 * bell(u), 0.3
      drawProps = draw
    end),
    A(0.6, function(a, u) -- flicks it up
      rest()
      local hx, hy = head()
      T.ffu, T.ffv = 7 + 8 * bell(seg(u, 0, 0.35)), 10 * bell(seg(u, 0, 0.35))
      T.nod = lerp(0.3, -0.35, ease(u))
      bx, by = lerp(toe, hx, u), lerp(BASE - R, hy - R, u) - 40 * S * 4 * u * (1 - u)
      spin = spin + 0.3
      drawProps = draw
    end),
    A(1.8, function(a, u, t) -- three headers
      rest()
      local hx, hy = head()
      local s = (u * 3) % 1
      bx, by = hx, hy - R - 24 * S * 4 * s * (1 - s)
      local hit = 1 - min(s, 1 - s) * 6
      T.nod, T.hop, T.sq = -0.3 - 0.2 * max(0, hit), 2 * max(0, hit), 0.06 * max(0, hit)
      T.f1, T.b1 = 1.3, -1.3
      spin = spin + 0.15
      drawProps = draw
    end),
    A(2.6, function(a, u, t) -- off it goes, bouncing down the line
      rest()
      if not a.x then a.x, a.y = head() a.land = {} end
      bx = a.x + f * 170 * S * t
      local T0, bounces = 0.45, { { 0.5, 26 }, { 0.36, 12 }, { 0.24, 5 } }
      if t < T0 then
        by = lerp(a.y - R, BASE - R, (t / T0) ^ 2)
      else
        local tt, k = t - T0, 1
        by = BASE - R
        while k <= #bounces and tt > bounces[k][1] do tt = tt - bounces[k][1] k = k + 1 end
        if k <= #bounces then
          local q = tt / bounces[k][1]
          by = BASE - R - bounces[k][2] * S * 4 * q * (1 - q)
        end
        if not a.land[k] then a.land[k] = true ripple(bx, 3) end
      end
      spin = -f * (bx - a.x) / R
      T.nod, T.jaw = 0.1 * ease(u), 0.3 * bell(seg(u, 0.7, 1))
      if u > 0.25 then brow("f") end
      if bx > -2 * R and bx < W + 2 * R then drawProps = draw end
    end),
  }
end

-- He blows up a balloon, it lifts him off the line (which stretches after his feet), he lets go.
function IDLES.balloon()
  local R, STR, r, bx, by, string = 11, 10, 0, 0, 0, nil -- held out in front: overhead it'd leave the screen
  local function draw()
    if r < 0.5 then return nil end
    local items = { oval(bx, by, r * S * 0.82, r * S, 14) }
    local kx, ky = bx, by + r * S
    if string then
      items[2] = { pt(kx - 1.5 * S, ky + 2 * S), pt(kx, ky), pt(kx + 1.5 * S, ky + 2 * S), pt(kx, ky), pt((kx + string[1]) / 2 + 3 * S * sin(clock * 3), (ky + string[2]) / 2), pt(string[1], string[2]) }
    end
    return items
  end
  local function mouth() return W2(headPt(P, 17, -2)) end
  return {
    A(2.8, function(a, u, t) -- three big breaths
      rest()
      local k, q = floor(u * 3), (u * 3) % 1
      r = R * (k + ease(seg(q, 0.4, 0.9))) / 3
      reachU("f", headPt(T, 17, -6))
      T.jaw = q > 0.4 and 0.25 or 0.05
      T.lean, T.nod = q < 0.4 and -0.1 * bell(q / 0.4) or 0.08, q < 0.4 and -0.2 * bell(q / 0.4) or 0.05
      local mx, my = mouth()
      bx, by = mx + P.face * (r * S * 0.82 + 1 * S), my
      drawProps = draw
    end),
    A(1.2, function(a, u) -- ties it off; it floats up on its string
      rest()
      local e = ease(u)
      local su, sv = shoulderOf(T)
      reachU("f", lerp(su + 14, su + 24, e), lerp(sv - 6, sv + 6, e))
      local hx, hy = HAND.f[1], HAND.f[2]
      local mx, my = mouth()
      bx, by = lerp(mx + P.face * r * S, hx, e), lerp(my, hy - (STR + r) * S, e)
      string = { hx, hy }
      drawProps = draw
    end),
    A(2.8, function(a, u, t) -- up he goes
      rest()
      local e = ease(seg(u, 0, 0.35)) * (1 - ease(seg(u, 0.9, 1)))
      local su, sv = shoulderOf(T)
      reachU("f", su + 24, sv + 6)
      T.hop, T.lean = 14 * e + 2 * sin(t * 3) * e, 0.06 * sin(t * 2) * e
      T.ffv, T.fbv, T.ffu, T.fbu = 4 * e, 2 * e, 7 + 2 * e, -7 - 1 * e
      T.b1, T.jaw = -0.08 + 0.5 * e, 0.3 * e
      local hx, hy = HAND.f[1], HAND.f[2]
      bx, by, string = hx + 2 * S * sin(t * 2), hy - (STR + r) * S, { hx, hy }
      drawProps = draw
    end),
    A(1.6, function(a, u, t) -- lets go: he drops, it floats away
      if not a.y then a.y, a.x = by, bx end
      rest()
      if u > 0.25 and not a.landed then a.landed = true ripple(P.x, 4) end
      T.sq = 0.3 * bell(seg(u, 0.2, 0.45))
      T.nod, T.f1, T.f2 = -0.45 * ease(u), lerp(2.5, 0.12, ease(seg(u, 0, 0.3))), 0.3
      by, bx = a.y - 90 * S * t * t - 20 * S * t, a.x + 3 * S * sin(t * 4)
      string = { bx - 4 * S, by + r * S + STR * 2 * S }
      drawProps = draw
    end),
    A(1.6, function(a, u, t) -- waves it goodbye
      if not a.y then a.y = by end
      rest()
      T.nod, T.f1, T.f2 = -0.45 * (1 - ease(seg(u, 0.8, 1))), 2.5, 0.3 + 0.5 * sin(t * 12)
      by = a.y - 200 * S * t
      string = { bx - 4 * S, by + r * S + STR * 2 * S }
      if by + r * S > -40 * S then drawProps = draw end
    end),
  }
end

-- A hula hoop: it rises out of the line to his waist, he swings his hips, it slides down and sinks.
function IDLES.hoop()
  local cx, cy, rx, ry, tilt, out = 0, BASE, 0, 0, 0, false
  local function draw()
    if not out or rx < 1 then return nil end
    local front, back = {}, {}
    local c, sn = cos(tilt), sin(tilt)
    for k = 0, 16 do -- the near half in front of him, the far half behind
      local a = k * pi / 16
      for h = 1, 2 do
        local x, y = rx * cos(a + (h - 1) * pi), ry * sin(a + (h - 1) * pi)
        local q = pt(cx + x * c - y * sn, cy + x * sn + y * c)
        if h == 1 then front[#front + 1] = q else back[#back + 1] = q end
      end
    end
    back.behind = true
    return { front, back }
  end
  local function waist() return W2(bodyPt(P, 0, 8)) end
  local function armsUp() T.f1, T.f2, T.b1, T.b2 = 1.9, 1.1, 1.7, 1.2 end
  return {
    A(1.1, function(a, u) -- it comes up out of the line round his feet
      rest()
      out = true
      local e = ease(u)
      local wx, wy = waist()
      cx, cy, rx, ry, tilt = P.x, lerp(BASE, wy, e), 24 * S * min(1, u * 3), 5 * S * min(1, u * 3), 0
      T.nod = 0.35 * (1 - e)
      if u > 0.5 then armsUp() end
      drawProps = draw
    end),
    A(5, function(a, u, t) -- round and round, faster as he gets the hang of it
      rest()
      armsUp()
      local w = t * (8 + 4 * u)
      local wx, wy = waist()
      cx, cy, tilt = wx + P.face * cos(w) * 5 * S, wy + sin(w) * 1.5 * S, 0.14 * sin(w)
      T.lean, T.hop, T.jaw = 0.07 * sin(w), 0.8 * abs(sin(w)), 0.25
      T.fbu, T.ffu = -7 - 1.5 * sin(w), 7 - 1.5 * sin(w)
      drawProps = draw
    end),
    A(0.8, function(a, u) -- it slides down to his ankles
      if not a.y then a.y = cy end
      rest()
      cy, tilt = lerp(a.y, BASE - 2 * S, u * u), 0.1 * (1 - u)
      T.nod, T.jaw = 0.4 * ease(u), 0.4 * bell(u)
      drawProps = draw
    end),
    A(0.7, function(a, u) -- and into the line
      if not a.r then a.r = true ripple(cx, 3) end
      rest()
      rx, ry = 24 * S * (1 - u), 5 * S * (1 - u)
      T.nod, T.f1, T.b1 = 0.2, 0.12 + 0.3 * bell(u), -0.08 - 0.3 * bell(u) -- a shrug
      drawProps = draw
    end),
  }
end

-- A bowler hat: plucked from the air and put on, tipped, thrown like a boomerang; it comes back
-- down over his eyes, he pushes it up, tips it once more and it's gone.
function IDLES.hat()
  local mode, sc, lift, tilt, fx, fy, ang = "air", 0, 0, 0, 0, 0, 0
  local function shapes(tf) -- brim, crown, band
    local crown = {}
    for k = 0, 8 do local a = pi - k * pi / 8 crown[#crown + 1] = tf(CROWN * cos(a), CROWN * sin(a)) end
    return { { tf(-BRIM, 2), tf(1.5 - BRIM, 0), tf(BRIM - 1.5, 0), tf(BRIM, 2) }, crown,
      { tf(0.6 - CROWN, BAND), tf(CROWN - 0.6, BAND) } }
  end
  local function onHead(u, v) -- lifted and tilted off his head, still in its frame
    local c, sn = cos(tilt), sin(tilt)
    return world(headPt(P, 2 + (u * c - v * sn) * sc, 21 + lift + (u * sn + v * c) * sc))
  end
  local function inAir(u, v)
    local c, sn = cos(ang), sin(ang)
    return pt(fx + P.face * (u * c - v * sn) * S * sc, fy - (u * sn + v * c) * S * sc)
  end
  local function draw()
    if mode == "worn" then -- the line draws the hat; only its band is separate
      return { { world(headPt(P, 2.6 - CROWN, 21 + lift + BAND)), world(headPt(P, CROWN + 1.4, 21 + lift + BAND)) } }
    end
    if sc < 0.05 then return nil end
    return shapes(mode == "lifted" and onHead or inAir)
  end
  local function show()
    if mode == "worn" then HATWORN = lift end
    drawProps = draw
  end
  local function atBrim() reachU("f", headPt(T, BRIM - 2, 22 + lift)) end
  local function inHand() fx, fy = HAND.f[1] - P.face * (BRIM - 3) * S, HAND.f[2] end
  return {
    A(0.6, function(a, u) -- reaches up into the air
      rest()
      reachU("f", headPt(T, 22, 42))
      T.nod = -0.3 * ease(u)
    end),
    A(0.5, function(a, u) -- and there's a hat in his hand
      rest()
      reachU("f", headPt(T, 22, 42))
      T.nod = -0.3
      mode, sc = "air", ease(u)
      inHand()
      show()
    end),
    A(0.8, function(a, u) -- puts it on
      rest()
      mode, sc, lift = "lifted", 1, 24 * (1 - ease(u))
      atBrim()
      T.nod = -0.3 * (1 - u)
      if u >= 1 then mode, lift = "worn", 0 end
      show()
    end),
    A(1.2, function(a, u) -- rather pleased with it
      rest()
      mode = "worn"
      akimbo()
      T.nod, T.hop = -0.15 * bell(u), 1.5 * bell(seg(u, 0.3, 0.7))
      show()
    end),
    A(1.8, function(a, u) -- tips it, with a little bow
      rest()
      local e = bell(u)
      lift, tilt = 8 * e, -0.3 * e
      mode = lift > 0.3 and "lifted" or "worn"
      T.lean, T.nod = 0.3 * e, 0.25 * e
      atBrim()
      show()
    end),
    A(0.9, function(a, u) -- takes it off, winds up and flings it
      rest()
      mode, lift, tilt = "air", 0, 0
      T.f2 = 0.5
      T.f1 = u < 0.5 and lerp(2.3, -0.7, ease(u / 0.5)) or lerp(-0.7, 1.9, ease((u - 0.5) / 0.3))
      T.lean = u < 0.5 and -0.1 * ease(u / 0.5) or 0.25 * ease(seg(u, 0.5, 0.8))
      if u < 0.7 then inHand() ang = -0.4 * u end
      if u >= 0.7 then
        if not a.x then a.x, a.y = fx, fy end
        local q = (u - 0.7) / 0.3
        fx, fy = a.x + P.face * 60 * S * q, a.y - 10 * S * q
      end
      show()
    end),
    A(2.6, function(a, u, t) -- out and round and back, spinning
      rest()
      if not a.x then a.x, a.y = fx, fy end
      local home = world(headPt(P, 2, 21 + 30)) -- just above his head
      local reach = max(40 * S, min(150 * S, (P.face > 0 and X1 - a.x or a.x - X0) - 24 * S))
      fx = lerp(a.x, home[1], u) + P.face * sin(u * pi) * reach
      fy = lerp(a.y, home[2], ease(u)) - sin(u * pi) * 30 * S
      ang = 0.25 * sin(t * 18)
      T.nod = -0.25 * bell(u)
      if u > 0.1 and u < 0.9 then brow("f") end
      show()
    end),
    A(0.35, function(a, u) -- drops on, too far
      rest()
      mode, sc, tilt = "lifted", 1, 0
      lift = lerp(30, -7, u * u)
      T.nod = -0.25 * (1 - u)
      if u >= 1 then mode = "worn" end
      show()
    end),
    A(1.8, function(a, u, t) -- can't see a thing; shoves it back up
      rest()
      mode = "worn"
      local blind = 1 - ease(seg(u, 0.6, 0.9))
      lift = -7 * blind
      T.f1, T.f2, T.b1, T.b2 = 1.4 * blind, 0.3, 1.3 * blind, 0.3
      T.ffv, T.fbv = max(0, sin(t * 9)) * 4 * blind, max(0, -sin(t * 9)) * 4 * blind
      T.lean, T.jaw = 0.1 * sin(t * 4.5) * blind, 0.4 * blind
      if u > 0.5 then atBrim() T.f1, T.f2 = lerp(1.4, T.f1, ease(seg(u, 0.5, 0.65))), lerp(0.3, T.f2, ease(seg(u, 0.5, 0.65))) end
      show()
    end),
    A(0.9, function(a, u) -- one last tip, and it's gone
      rest()
      lift, tilt = 6 * ease(u), -0.2 * ease(u)
      sc = 1 - ease(seg(u, 0.45, 1))
      mode = lift > 0.3 and "lifted" or "worn"
      atBrim()
      T.lean = 0.15 * bell(u)
      show()
    end),
  }
end

local MOODS = { -- weights: a lit room is for dancing, a dark one for sleeping
  on = { stroll = 4, look = 2, tapfoot = 1, yawn = 1, sit = 1, wave = 2, watch = 1, sleep = 0.5, dive = 2,
    dance = 2, grumble = 1, hop = 2, balance = 1, scratch = 1, crossed = 1.5, heels = 1.5, bow = 1, tiptoe = 1,
    shakelegs = 1, lookup = 1, shoo = 1, runspot = 1, sigh = 0.5, ponder = 1, kick = 1.5,
    chair = 1.5, flower = 1.5, ball = 1.5, balloon = 1.2, hoop = 1.2, hat = 1.2 },
  off = { stroll = 2, look = 2, tapfoot = 1, yawn = 2, sit = 2, wave = 0.5, watch = 1, sleep = 3, dive = 1,
    grumble = 1, hop = 0.5, balance = 0.5, peer = 2, scratch = 1.5, crossed = 1, heels = 1, bow = 0.3,
    tiptoe = 2, shakelegs = 0.5, lookup = 1.5, shoo = 0.5, runspot = 0.3, sigh = 2, ponder = 1.5, kick = 0.5,
    chair = 2, flower = 0.4, balloon = 0.6, hoop = 0.4, hat = 1 }, -- no ball: it would roll into the break
}
local function pickIdle()
  local w, sum = MOODS[visOn and "on" or "off"], 0
  for k, v in pairs(w) do if k ~= lastIdle then sum = sum + v end end
  local r = random() * sum
  for k, v in pairs(w) do
    if k ~= lastIdle then
      r = r - v
      if r <= 0 then lastIdle = k return IDLES[k]() end
    end
  end
  return { pause(1) }
end

-- Shaken: he windmills, topples onto his back (or his face, if there's no room behind him), lies
-- there seeing stars, and gets up again.
local function planFall()
  local behindX = P.x - P.face * 115 * S
  local room = behindX > X0 + 8 * S and behindX < X1 - 8 * S and not (gapC and (behindX - gapC) * (P.x - gapC) < 0)
  local f = room and 1 or -1
  local down = f > 0 and 1.52 or -1.4 -- face down he lands a little short of flat, chin up
  local function legsUp(e, t)
    if f > 0 then -- on his back: legs straight up in the air (his forward is up now)
      T.ffu, T.ffv, T.fbu, T.fbv = lerp(7, 38, e) + 3 * sin(t * 11) * e, lerp(0, 34, e), lerp(-7, 32, e), lerp(0, 28, e)
    else -- on his face: heels up behind him
      T.ffu, T.ffv, T.fbu, T.fbv = lerp(7, -30, e), lerp(0, 26, e), lerp(-7, -36, e) - 3 * sin(t * 11) * e, lerp(0, 30, e)
    end
  end
  local function stars(t)
    return function()
      local c = world(headPt(P, 3, 16))
      local items = {}
      for k = 1, 3 do
        local a = t * 5 + k * 2 * pi / 3
        local x, y, r, p = c[1] + cos(a) * 16 * S, c[2] - 14 * S + sin(a) * 4 * S, 3 * S, {}
        for i = 0, 10 do local b = i * pi / 5 - pi / 2 local rr = i % 2 == 0 and r or r * 0.4 p[#p + 1] = pt(x + cos(b) * rr, y + sin(b) * rr) end
        items[k] = p
      end
      return items
    end
  end
  return {
    A(0.8, function(a, u, t) -- whoa, whoa
      rest()
      T.f1, T.b1, T.f2, T.b2 = 1.6 + 1.4 * sin(t * 16), 1.6 + 1.4 * sin(t * 16 + pi), 0.3, 0.3
      T.lean, T.jaw, T.hop = 0.18 * sin(t * 10) - 0.15 * f * u, 0.7, 2 * abs(sin(t * 10))
    end, { falling = true, k = 0.04 }),
    A(0.45, function(a, u, t) -- over he goes
      if not a.p then a.p = true P.pv = f > 0 and min(P.fbu, P.ffu) - 5 or max(P.fbu, P.ffu) + 11 end
      rest()
      T.fall = down * u * u
      legsUp(ease(u), t)
      T.f1, T.b1, T.jaw = 2.6, 2.3, 0.9
      if f < 0 then T.nod = -0.5 * u end
    end, { falling = true, k = 0.025 }),
    A(0.35, function(a, u, t) -- thud
      if not a.r then a.r = true ripple(world(headPt(P, 2, 14))[1], 7) end
      rest()
      T.fall = down + f * 0.12 * bell(u)
      legsUp(1, t)
      T.f1, T.b1, T.jaw = 1.2, 1.0, 0.5
      if f < 0 then T.f1, T.b1, T.nod = 2.9, 2.7, -0.5 end -- arms out flat ahead of him
    end, { falling = true, k = 0.03 }),
    A(1.8, function(a, u, t) -- seeing stars
      rest()
      T.fall = down
      legsUp(1 - 0.6 * ease(seg(u, 0.3, 0.6)), t * (1 - u))
      T.f1, T.b1, T.jaw, T.nod = 1.0, 0.8, 0.2, 0.1 * sin(t * 3)
      if f < 0 then T.f1, T.b1, T.nod = 2.9 + 0.1 * sin(t * 6), 2.7, -0.5 + 0.1 * sin(t * 3) end
      drawProps = stars(t)
    end, { falling = true }),
    A(1.1, function(a, u, t) -- back on his feet
      rest()
      T.fall = down * (1 - ease(u))
      legsUp(0.4 * (1 - ease(u)), 0)
      T.f1, T.b1 = lerp(f > 0 and 1.0 or 2.9, 0.12, ease(u)), lerp(f > 0 and 0.8 or 2.7, -0.08, ease(u))
      if f < 0 then T.nod = -0.5 * (1 - ease(u)) end
      if u < 0.5 then drawProps = stars(clock) end
    end, { falling = true }),
    A(1.0, function(a, u, t) -- dusts himself off and shakes his head
      rest()
      T.nod = 0.25 * sin(t * 14) * (1 - u)
      T.f1, T.f2 = 1.0, 0.9 + 0.35 * sin(t * 22)
      T.b1, T.b2 = 1.1, 0.9 - 0.35 * sin(t * 22)
    end, { falling = true }),
  }
end

-- ── input ───────────────────────────────────────────────────────────────────

local function stop() -- drop whatever he was up to (unless it's lamp work)
  if act and act.done then act.done() end
  act, plan = nil, {}
  for _, o in ipairs({ bang, pct, zs[1], zs[2], zs[3] }) do o:set { text_opa = 0 } end
  scribble:add_flag(HIDDEN)
  idleAt = clock + 4
end
local function toggle()
  on = not on
  publish()
  if not (act and act.light) then stop() end
  idleAt = clock + 4
end
local function startDim(fromZero)
  stop()
  if not on or not visOn or fromZero then level = 0 end
  if not on then on = true end
  act = dimAct()
  publish()
end
local function endDim()
  if not (act and act.dim) then return end
  local D, hy = act.D, act.hy or BASE
  act = letGo(D, hy)
  if level <= 0 then on, level = false, 60 end
  publish()
  idleAt = clock + 4
end

-- ── the frame: LVGL's timer pump, ~30 fps ───────────────────────────────────

local lastMs = time.ticks_ms()
local vis, was, colorOf = {}, {}, {}
for i = 1, #strokes do vis[i] = true end

local roomWas = -1
local function same(a, b)
  if not b or #a ~= #b then return false end
  for i = 1, #a do if a[i][1] ~= b[i][1] or a[i][2] ~= b[i][2] then return false end end
  return true
end
local function put(i, pts, color) -- only what changed reaches LVGL (each set repaints the line's box)
  local l = strokes[i]
  if not pts or #pts < 2 then
    if vis[i] then l:add_flag(HIDDEN) vis[i], was[i] = false, nil end
    return
  end
  if not vis[i] then l:clear_flag(HIDDEN) vis[i] = true end
  if color ~= colorOf[i] then l:set { line_color = color } colorOf[i] = color end
  if not same(pts, was[i]) then l:set { points = pts } was[i] = pts end
end
-- The line from one of his feet (e) down to the ground, leaving it sideways (dir) and landing as far
-- out as the foot is high, so a foot in the air is held by a curve, not a post. Returns the points
-- from the foot outwards (not the foot itself) and where it meets the ground.
local function join(e, dir)
  local h = BASE - e[2]
  local d = max(2 * S, h * 0.9)
  local gx = clamp(e[1] + dir * d, 1, W - 2)
  if h < 1.5 * S then return { gpt(gx) }, gx end
  local gy = BASE + (rip and ripAt(gx) or 0)
  local x1, x2, pts = e[1] + dir * d * 0.5, gx - dir * d * 0.4, {}
  for k = 1, 6 do
    local q = k / 6
    local a, b, c, w = (1 - q) ^ 3, 3 * (1 - q) ^ 2 * q, 3 * (1 - q) * q * q, q ^ 3
    pts[k] = pt(a * e[1] + b * x1 + c * x2 + w * gx, a * e[2] + b * e[2] + c * gy + w * gy)
  end
  return pts, gx
end
local function split(pts, runs) -- pen-up marks (false) end a run
  local cur = {}
  for i = 1, #pts do
    if pts[i] then cur[#cur + 1] = pts[i] else runs[#runs + 1] = cur cur = {} end
  end
  runs[#runs + 1] = cur
end

local function frame()
  local now = time.ticks_ms()
  local dt = clamp(time.ticks_diff(now, lastMs), 0, 100) / 1000
  lastMs = now
  clock = clock + dt

  if holding and act and act.dim then
    level = clamp(level + holdDir * 45 * dt, 0, 100)
    dirty = true
  end

  if not act then
    if #plan > 0 then
      act = table.remove(plan, 1)
    elseif visOn ~= on then
      plan = on and planOn() or planOff()
      act = table.remove(plan, 1)
    elseif clock >= idleAt then
      plan = pickIdle()
      act = table.remove(plan, 1)
    end
  end
  feat, drawProps, HATWORN = nil, nil, nil
  local k = 0.08
  if act then
    act.t = act.t + dt
    act.step(act, act.dur > 0 and min(1, act.t / act.dur) or 1, act.t)
    k = act.k or k
    if act.t >= act.dur then
      if act.done then act.done() end
      act = nil
      if #plan == 0 then idleAt = max(idleAt, clock + 1.2 + 1.8 * random()) end
    end
  else
    rest()
  end
  -- The break stays while he plays near it (a bump under the line); lamp work reshapes it itself.
  local feats = {}
  if feat then feats[1] = feat end
  if gapC and (not feat or feat.k == "hump") then
    feats[#feats + 1] = gapF(gapC)
    if feat and feat.c > gapC then feats[1], feats[2] = feats[2], feats[1] end
  end

  local a = 1 - exp(-dt / k)
  for _, f in ipairs(SMOOTH) do P[f] = P[f] + (T[f] - P[f]) * a end
  if rip then rip.t = rip.t + dt if rip.t > 1.4 then rip = nil end end
  lit = flicker or (lit + ((visOn and 1 or 0) - lit) * (1 - exp(-dt / 0.15)))

  -- The ground to his heel, the man (joined to it at both feet), the ground from his toe.
  local runs, out, legs, near, far, things = {}, nil, nil, nil, {}, {}
  local left = { gpt(0) }
  if P.sink > 0.97 then -- he's under the line
    ground(left, 0, W - 1, feats)
    split(left, runs)
  else
    out, legs, near, far = figure()
    for _, it in ipairs(drawProps and drawProps() or {}) do
      if it.behind then
        for _, r in ipairs(behind(out, it)) do things[#things + 1] = r end
      else
        things[#things + 1] = it
      end
    end
    -- His feet are always on the line: where one is off the ground, the line curves up to it.
    local inL, lx = join(out[1], -1)
    local outR, rx = join(out[#out], 1)
    ground(left, 0, lx, feats)
    split(left, runs)
    local whole = {}
    for i = #inL, 1, -1 do whole[#whole + 1] = inL[i] end
    for i = 1, #out do whole[#whole + 1] = out[i] end
    for i = 1, #outR do whole[#whole + 1] = outR[i] end
    out = whole
    local right = { gpt(rx) }
    ground(right, rx, W - 1, feats)
    split(right, runs)
  end

  local lv = clamp(level, 0, 100) / 100
  local color = mono and OFF or mix(OFF, mix(LOW, HIGH, lv), clamp(lit, 0, 1))
  put(1, out, color)
  put(2, legs, color)
  put(3, near, color)
  for i = 1, 3 do put(3 + i, far[i], color) end
  for i = 1, 3 do put(6 + i, runs[i], color) end
  for i = 1, #strokes - PROPS do put(PROPS + i, things[i], color) end
  local rc = mono and 0 or mix(0, ROOM, clamp(lit, 0, 1) * (0.03 + 0.13 * lv))
  if rc ~= roomWas then room:set { bg_color = rc } roomWas = rc end
end

lvgl.Timer { period = 33, cb = frame }

-- ── Resident callbacks ──────────────────────────────────────────────────────

function init(ctx)
  local o, l = store.get("on"), store.get("level")
  if type(o) == "boolean" then on = o end
  if type(l) == "number" then level = clamp(floor(l), 1, 100) end
  visOn, lit = on, on and 1 or 0
  if not on then gapC = clamp(P.x + REACH, XMIN + REACH, XMAX) end
  scribble:add_flag(HIDDEN)
  log.info("la linea: " .. W .. "x" .. H .. ", lamp " .. (on and ("on " .. level .. "%") or "off"))
end

function on_tick(ctx, dt_ms)
  -- While dimming, tell the lamp at most ~3 times a second.
  if dirty and ctx.time_ms - sentAt >= 300 then
    sentAt = ctx.time_ms
    level = floor(level + 0.5)
    publish()
  end
end

function on_event(ctx, e)
  local n, d = e.name, e.data
  if n == "touch_down" then
    drag = { x = d.x, y = d.y, moved = false }
  elseif n == "touch_move" and drag then
    local dx, dy = d.x - drag.x, d.y - drag.y
    if not drag.moved and dx * dx + dy * dy >= 100 then
      drag.moved = true
      startDim()
      drag.from, drag.x, drag.y = level, d.x, d.y
      dx, dy = 0, 0
    end
    if drag.moved and act and act.dim then
      -- Up or right brightens, down or left dims, whichever way the finger mostly goes.
      local v = abs(dy) >= abs(dx) and -dy / (0.6 * H) or dx / (0.7 * W)
      level = floor(clamp(drag.from + v * 100, 0, 100) + 0.5)
      dirty = true
    end
  elseif n == "touch_up" then
    if drag and drag.moved then endDim() end
    drag = nil
  elseif n == "touch_tap" then
    toggle()
  elseif n == "tap" and d.index == 0 then
    toggle()
  elseif n == "hold" and d.index == 0 then
    if d.held then
      holdDir = (level >= 99 and -1) or (level <= 1 and 1) or -holdDir
      if not on or not visOn then holdDir = 1 end
      holding = true
      startDim()
    else
      holding = false
      level = floor(level + 0.5)
      endDim()
    end
  elseif n == "tap" and d.index == 1 then -- B (a shake, on this bench): it knocks him over
    if act and (act.light or act.falling) then return end
    stop()
    plan = planFall()
    act = table.remove(plan, 1)
  end
end
