-- Porous systems: the porous.systems logo. Its spokes sweep in over 1.5 s and the words fade in. The encoder moves the hollow spoke, the button stamps one where it is, the slide pot colours the background; touch the screen or tap A to start again.
-- @output display
local g = lgfx.bind("main")
local s = screens.get("main")
local W, H = g:width(), g:height()
local floor, min, max, pi = math.floor, math.min, math.max, math.pi
-- E-paper, the one scheme that isn't dark: every flip is a slow refresh, so the logo goes up whole.
local paper = s.scheme ~= "dark"
local BG, FG = paper and 0xFFFFFF or 0x000000, paper and 0x111111 or 0xFFFFFF
-- Edges are anti-aliased in this many shades on a colour screen; a 1-bit one is lit or not.
local LEVELS = s.depth == 16 and 8 or 1
local SUB = 4 -- sub-rows sampled per pixel row

-- logo data: written by scripts/logo-app.mjs from the logo SVG, do not edit
local STROKE, INNER = 17, 250
-- spokes: { angle (0.1°), outer radius[, width, outline: a hollow one] }, in 0.1 units
local SPOKES = {
  {-1778,375,19,5},{-1709,366},{-1640,358},{-1571,349},{-1502,341},{-1433,333},{-1364,326},{-1295,320},{-1225,315},
  {-1156,311},{-1087,308},{-1018,308},{-949,308},{-880,310},{-811,314},{-742,319},{-673,325},{-604,332},
  {-535,339},{-466,347},{-397,356},{-328,364},{-259,373},{-190,382},{-121,391},{-52,400},{17,409},
  {86,418},{155,427},{224,436},{293,444},{362,452},{432,460},{501,466},{570,472},{639,476},
  {708,479},{777,480},{846,479},{925,477},{994,473},{1063,467},{1132,461},{1201,454},{1270,446},
  {1339,438},{1408,429},{1477,420},{1546,411},{1615,402},{1684,393},{1753,384},
}
-- letters: contours, each its start then one character per x and y step (see V)
local GLYPHS = {
  {{11,16,"@KK+K+UKKQMKNGOIQJQKRPPSMWIWFSCPAJGIHGIKKb"},{23,-7,"OJOHMELDJDIEGHGJFLGNIQJRLRMPOOPL"}},
  {{23,1,"AIDFFCJAL@PCRFUJULRPOSMVIUGSDPAM"},{23,-7,"PJOHMEKDKCIFGHFIFMGNIPJSLRMQONPL"}},
  {{11,0,"@KK3K3UKKSMKMGMHPJQJKUAMHMINJQKf"}},
  {{16,1,"FJFIHHIFJDK,VKKmNPPMRIODK,VKKdKdBKKDIKFQGMFK"}},
  {{21,1,"CJDHGEIEUKNPPNRKOHLGIH8CGHIGKEMEQGRJRKRNOPMQAKHFEIGLIMJNLMON^SNOMPJRGOENCL"}},
  {{19,16,"@KT:C4B3VKVmMKV*UKBdBdC["}},
  {{22,0,"@KGEK)DKKCRKK?UKKWSKKSCKLiLPNQ"}},
  {{23,1,"AIDFFCJAL@PCRFTJULQPOSMVKN*KMTOONLPKNJNHMGUKHRGPENDL"},{11,-29,"bKJFIGHHFJGLGNIOJP"}},
  {{11,0,"@KK3K3UKKRMKMGNHQJTLNNNOMKOEPITKQNMOMRKo@KK)IFFJEMGQKl@KK-IDIIHJGKHMHOJPKi"}},
}
-- words: { baseline, letter, left edge, letter, left edge, … }
local WORDS = {
  {491,1,360,2,412,3,467,2,499,4,554,5,603},
  {586,5,332,6,374,5,422,7,467,8,498,9,551,5,627},
}
-- end of logo data

-- Fit the logo: on round glass the ring's centre is the screen's; elsewhere the whole mark, centred.
local half = STROKE / 2
local x0, x1, y0, y1, reach = 1e9, -1e9, 1e9, -1e9, 0
for _, p in ipairs(SPOKES) do
  local a = p[1] * pi / 1800
  for _, r in ipairs({ INNER, p[2] }) do
    local x, y = 500 + math.cos(a) * r, 500 + math.sin(a) * r
    x0, x1, y0, y1 = min(x0, x - half), max(x1, x + half), min(y0, y - half), max(y1, y + half)
  end
  reach = max(reach, p[2] + half)
end
local K, OX, OY -- pixels per 0.1 unit, and where the ring's centre lands
if s.shape == "round" then
  K = min(W, H) * 0.46 / reach
  OX, OY = W / 2, H / 2
else
  K = min(W * 0.9 / (x1 - x0), H * 0.9 / (y1 - y0))
  OX, OY = W / 2 - ((x0 + x1) / 2 - 500) * K, H / 2 - ((y0 + y1) / 2 - 500) * K
end
local WORDS_SHOWN = K * 50 >= 6 -- the words, once their x-height reaches 6 px

-- Shapes are kept as runs of one shade, packed 7 bytes each (x, y, width, shade), so every shape is
-- worked out once and can be repainted in a new colour. Working them out is most of what the app
-- costs a board, so both kinds below measure as few pixels as they can and make no tables per row.
local RUN = "<i2i2i2B"

-- The words: polygon contours (flat x, y lists in pixels, even-odd), each pixel row sampled at SUB
-- heights. A span adds its end pixels' fractions to `part` and its whole pixels to `step` (+1 where
-- they start, -1 after them), so one pass along the row sums each pixel's cover.
local function raster(contours)
  local edges, top, bottom, left, right = {}, 1e9, -1e9, 1e9, -1e9
  for _, c in ipairs(contours) do
    local n = #c
    for i = 1, n, 2 do
      local j = i + 2 > n and 1 or i + 2
      local ax, ay, bx, by = c[i], c[i + 1], c[j], c[j + 1]
      if ay ~= by then
        if ay > by then ax, ay, bx, by = bx, by, ax, ay end
        edges[#edges + 1] = { ay, by, ax, (bx - ax) / (by - ay) }
        top, bottom, left, right = min(top, ay), max(bottom, by), min(left, ax, bx), max(right, ax, bx)
      end
    end
  end
  table.sort(edges, function(p, q) return p[1] < q[1] end)
  local base = floor(left) - 1 -- pixel x is index x - base
  local part, step = {}, {}
  for i = 1, floor(right) - base + 2 do part[i], step[i] = 0, 0 end
  local runs, active, nxt, xs, scale = {}, {}, 1, {}, LEVELS / SUB
  for py = floor(top), math.ceil(bottom) - 1 do
    local lo, hi = 1e9, -1e9
    for k = 0, SUB - 1 do
      local sy = py + (k + 0.5) / SUB
      while edges[nxt] and edges[nxt][1] <= sy do
        active[#active + 1] = edges[nxt]
        nxt = nxt + 1
      end
      local m, i = 0, 1
      while i <= #active do
        local e = active[i]
        if e[2] <= sy then -- past its end: the last one takes its place
          active[i] = active[#active]
          active[#active] = nil
        else
          m = m + 1
          xs[m] = e[3] + (sy - e[1]) * e[4]
          i = i + 1
        end
      end
      for j = #xs, m + 1, -1 do xs[j] = nil end
      table.sort(xs)
      for j = 1, m - 1, 2 do
        local a, b = xs[j] - base, xs[j + 1] - base
        local ia, ib = floor(a), floor(b)
        if ia == ib then
          part[ia] = part[ia] + b - a
        else
          part[ia] = part[ia] + ia + 1 - a
          step[ia + 1] = step[ia + 1] + 1
          step[ib] = step[ib] - 1
          part[ib] = part[ib] + b - ib
        end
        if ia < lo then lo = ia end
        if ib > hi then hi = ib end
      end
    end
    local whole, rx, rs = 0, lo, 0
    for i = lo, hi do
      whole = whole + step[i]
      local sh = ((whole + part[i]) * scale + 0.5) // 1
      part[i], step[i] = 0, 0
      if sh ~= rs then
        if rs > 0 then runs[#runs + 1] = string.pack(RUN, rx + base, py, i - rx, rs) end
        rx, rs = i, sh
      end
    end
    if rs > 0 then runs[#runs + 1] = string.pack(RUN, rx + base, py, hi + 1 - rx, rs) end
  end
  return table.concat(runs)
end

-- The hollow spoke (the encoder's cursor) and its width and outline, and the ones stamped hollow.
local n, HOME, HW, HO = #SPOKES
for k, p in ipairs(SPOKES) do if p[4] then HOME, HW, HO = k, p[3], p[4] end end
local cursor, stamped = HOME, {}
local function isHollow(k) return k == cursor or stamped[k] end

-- A spoke: a stroke with round ends along an axis from radius INNER out to its own, at its angle.
-- How much of a pixel it covers follows the distance from the pixel's centre to that axis: all of
-- it within ro - 0.5 px, none beyond ro + 0.5. A hollow one is the outline between two strokes,
-- ri and ro. Along a row only the pixels at its edges are measured; the ones between are one run.
local function spokeRuns(k)
  local p, hollow, sqrt, pack = SPOKES[k], isHollow(k), math.sqrt, string.pack
  local ro, ri = max((hollow and HW or STROKE) / 2 * K, LEVELS == 1 and 0.5 or 0), -1
  if hollow then -- its outline: 1 px at least on 1-bit
    local o = max(HO / 2 * K, LEVELS == 1 and 0.5 or 0)
    ro, ri = ro + o, max(ro - o, 0.1)
  end
  local a = p[1] * pi / 1800
  local c, sn, len = math.cos(a), math.sin(a), (p[2] - INNER) * K
  local ax, ay = OX + c * INNER * K, OY + sn * INNER * K
  local bx, by = ax + c * len, ay + sn * len
  local ic = math.abs(c) > 1e-6 and 1 / c -- false along a vertical axis
  local is = math.abs(sn) > 1e-6 and 1 / sn -- false along a level one
  local aw = is and math.abs(is) or 0 -- how far in x a row goes for 1 px aside of the axis

  -- The pixels on a row whose centres lie within r of the axis: lo to hi (none if lo > hi). dy and
  -- ey are the row's height below each end; between the ends, the row is from al to ah along the
  -- axis and crosses it at xm. The stroke is convex, so they're one span: the band and the ends.
  local function span(dy, ey, al, ah, xm, r)
    local lo, hi, rr = al, ah, r * r
    if is then
      if xm - r * aw > lo then lo = xm - r * aw end
      if xm + r * aw < hi then hi = xm + r * aw end
    elseif dy * c > r or dy * c < -r then hi = lo - 1 end
    if lo > hi then lo, hi = 1e9, -1e9 end
    local e = rr - dy * dy
    if e >= 0 then
      e = sqrt(e)
      if ax - e < lo then lo = ax - e end
      if ax + e > hi then hi = ax + e end
    end
    e = rr - ey * ey
    if e >= 0 then
      e = sqrt(e)
      if bx - e < lo then lo = bx - e end
      if bx + e > hi then hi = bx + e end
    end
    return -((0.5 - lo) // 1), (hi - 0.5) // 1
  end

  -- The core of each row: covered whole (solid) or not at all (inside a hollow one's outline).
  local core, rc, ro5, ri5 = hollow and 0 or LEVELS, (hollow and ri or ro) - 0.5, ro + 0.5, ri + 0.5
  local runs, nr = {}, 0
  for py = floor(min(ay, by) - ro - 1), math.ceil(max(ay, by) + ro) do
    local y = py + 0.5
    local dy, ey, al, ah, xm = y - ay, y - by, -1e9, 1e9, 0
    local t = dy * sn
    if ic then
      al, ah = ax - t * ic, ax + (len - t) * ic
      if al > ah then al, ah = ah, al end
    elseif t < 0 or t > len then ah = al - 1 end
    if is then xm = ax + dy * c * is end
    local xa, xb = span(dy, ey, al, ah, xm, ro5)
    if xa <= xb then
      local ca, cb = xb + 1, xb
      if rc > 0 then
        ca, cb = span(dy, ey, al, ah, xm, rc)
        if ca > cb then ca = xb + 1 end
      end
      -- How far along the axis and how far aside of it pixel x's centre is: each pixel on adds c
      -- to the one and takes sn off the other.
      local dx = xa + 0.5 - ax
      local q
      t, q = dx * c + dy * sn, dy * c - dx * sn
      local x, rx, rs = xa, xa, 0
      while x <= xb do
        local sh, at = nil, x
        if x == ca then -- the core, in one step
          sh = core
          local m = cb + 1 - x
          x, t, q = cb + 1, t + m * c, q - m * sn
        else
          local d
          if t < 0 then d = sqrt(t * t + q * q)
          elseif t > len then d = sqrt((t - len) * (t - len) + q * q)
          else d = q < 0 and -q or q end
          local f = ro5 - d
          f = f < 0 and 0 or f > 1 and 1 or f
          if hollow then
            local e = ri5 - d
            f = f - (e < 0 and 0 or e > 1 and 1 or e)
          end
          sh = (f * LEVELS + 0.5) // 1
          x, t, q = x + 1, t + c, q - sn
        end
        if sh ~= rs then
          if rs > 0 then nr = nr + 1; runs[nr] = pack(RUN, rx, py, at - rx, rs) end
          rx, rs = at, sh
        end
      end
      if rs > 0 then nr = nr + 1; runs[nr] = pack(RUN, rx, py, xb + 1 - rx, rs) end
    end
  end
  return table.concat(runs)
end

-- A letter's steps, one character each: '#' to 't' less the backslash stand for -40..40.
local V, v = {}, -40
for c = 35, 116 do
  if c ~= 92 then V[c], v = v, v + 1 end
end

local function wordRuns()
  local contours = {}
  for _, w in ipairs(WORDS) do
    for i = 2, #w, 2 do
      for _, c in ipairs(GLYPHS[w[i]]) do
        local x, y, pts = w[i + 1] + c[1], w[1] + c[2], {}
        for j = 1, #c[3], 2 do
          pts[#pts + 1] = OX + (x - 500) * K
          pts[#pts + 1] = OY + (y - 500) * K
          x, y = x + V[c[3]:byte(j)], y + V[c[3]:byte(j + 1)]
        end
        contours[#contours + 1] = pts
      end
    end
  end
  return raster(contours)
end

-- Shade i of LEVELS, f of the way from the background to the ink.
local function palette(f)
  local pal = {}
  for i = 1, LEVELS do
    local t, c = f * i / LEVELS, 0
    for sh = 0, 16, 8 do
      local b, i2 = (BG >> sh) & 255, (FG >> sh) & 255
      c = c | (floor(b + (i2 - b) * t + 0.5) << sh)
    end
    pal[i] = c
  end
  return pal
end
local INK, ERASE = palette(1), palette(0)

-- The slide pot picks the background: black at the bottom, round the colour wheel, white at the top
-- (a 1-bit screen: black or white). The ink is white or near-black, whichever reads on it.
local function setBackground(f)
  if LEVELS == 1 or f < 0.03 or f > 0.97 then
    BG = f < 0.5 and 0 or 0xFFFFFF
  else
    local h = (f - 0.03) / 0.94 * 6
    local x = 1 - math.abs(h % 2 - 1)
    local t = ({ { 1, x, 0 }, { x, 1, 0 }, { 0, 1, x }, { 0, x, 1 }, { x, 0, 1 }, { 1, 0, x } })[floor(h) % 6 + 1]
    BG = 0
    for j = 1, 3 do BG = BG << 8 | floor((0.27 + 0.63 * t[j]) * 255 + 0.5) end -- saturation 0.7, value 0.9
  end
  local lum = (0.2126 * (BG >> 16) + 0.7152 * (BG >> 8 & 255) + 0.0722 * (BG & 255)) / 255
  FG = lum > 0.55 and (LEVELS == 1 and 0 or 0x111111) or 0xFFFFFF
  INK, ERASE = palette(1), palette(0)
end

local function paint(runs, pal)
  for i = 1, #runs, 7 do
    local x, y, w, sh = string.unpack(RUN, runs, i)
    g:fillRect(x, y, w, 1, pal[sh])
  end
end

-- Each spoke's shapes, solid and hollow, rasterised once and kept.
local shapes = {}
local function shape(k)
  local key = k * 2 + (isHollow(k) and 1 or 0)
  shapes[key] = shapes[key] or spokeRuns(k)
  return shapes[key]
end

-- The intro: the spokes sweep in clockwise from the hollow one over SWEEP ms, then the words fade
-- in over FADE ms. It follows the clock, not the ticks, so it takes as long on every board. E-paper
-- gets the end of it in one frame, and 1-bit can't fade.
local SWEEP, FADE = 1500, LEVELS == 1 and 0 or 500
local began, start, swept, drawn, words, shown = 0, HOME, 0, {}, nil, 0
-- began: when the sweep started (ms); swept: how many spokes it has drawn; shown: how far the words
-- have faded in

local function advance(now)
  local t = time.ticks_diff(now, began)
  local due = paper and n or min(n, t * n // SWEEP + 1)
  local fade = 0
  if WORDS_SHOWN and (paper or t >= SWEEP) then fade = (paper or FADE == 0) and 1 or min(1, (t - SWEEP) / FADE) end
  if swept >= due and fade <= shown then return end
  while swept < due do
    local k = (start - 1 + swept) % n + 1
    drawn[k] = true
    paint(shape(k), INK)
    swept = swept + 1
  end
  if fade > shown then
    shown = fade
    paint(words, palette(shown))
  end
  g:flip()
end

local function restart(now)
  began, start, swept, drawn, shown = now, cursor, 0, {}, 0
  g:fillScreen(BG)
  advance(now)
end

-- Everything drawn so far, in the current colours (from the kept shapes: no rasterising).
local function repaint()
  g:fillScreen(BG)
  for k in pairs(drawn) do paint(shape(k), INK) end
  if shown > 0 then paint(words, palette(shown)) end
  g:flip()
end

-- Change spokes ks with `apply`: erase them, apply, redraw them and their neighbours (their edges
-- share pixels), leaving any the intro hasn't reached yet.
local function change(ks, apply)
  for _, k in ipairs(ks) do
    if drawn[k] then paint(shape(k), ERASE) end
  end
  apply()
  for _, k in ipairs(ks) do
    for i = k - 2, k do
      local j = i % n + 1
      if drawn[j] then paint(shape(j), INK) end
    end
  end
  g:flip()
end

-- Bench drivers (also on a real board through Bench's mirror). Which part drives each is the
-- user's choice in Connections; these are the defaults.
local spoke = dial and dial.new("spoke", { label = "Hollow spoke", via = "encoder" })
local bg = dial and dial.new("background", { label = "Background", via = "pot", min = 0, max = 100 })
-- Stamp names Button 1: on a board with one button of its own, Bench would give it to B first.
local stamp = trigger and trigger.new("stamp", { label = "Stamp", via = "external-button", connect = "button-1:press" })
local offset = 0 -- stamping steps the cursor on, past the encoder's own count
local recolour = false

local function follow()
  local to = (HOME - 1 + spoke:value() + offset) % n + 1
  if to ~= cursor then change({ cursor, to }, function() cursor = to end) end
end

function init(ctx)
  -- The words take a board longest to work out: before the first frame, not in the intro.
  if WORDS_SHOWN then words = wordRuns() end
  restart(time.ticks_ms())
end

function on_tick(ctx, dt_ms)
  if recolour then
    recolour = false
    setBackground(bg:fraction())
    repaint()
  end
  advance(time.ticks_ms())
end

function on_event(ctx, e)
  local d = e.data
  -- A touch on the screen (or a tap on A) sweeps the logo in again.
  if e.name == "touch_down" or (e.name == "tap" and d.index == 0) then restart(time.ticks_ms()) end
  if e.name == "dial" and d.name == "spoke" then follow() end
  -- The pot moves in many small steps: recolour once a tick.
  if e.name == "dial" and d.name == "background" then recolour = true end
  -- Stamp the cursor's spoke hollow (or solid again), then step the cursor on so the stamp shows.
  if e.name == "trigger" and d.name == "stamp" and d.pressed then
    stamped[cursor] = not stamped[cursor]
    offset = offset + 1
    follow()
  end
end
