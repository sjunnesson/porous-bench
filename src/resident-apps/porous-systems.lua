-- Porous systems: the porous.systems logo. Its spokes sweep in around the ring and the words fade in; turn the encoder to move the hollow spoke, tap A to see it all again.
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

-- Rasterise polygon contours (flat x, y lists in pixels, even-odd) into runs {x, y, width, shade}.
local function raster(contours)
  local edges, top, bottom = {}, 1e9, -1e9
  for _, c in ipairs(contours) do
    local n = #c
    for i = 1, n, 2 do
      local j = i + 2 > n and 1 or i + 2
      local ax, ay, bx, by = c[i], c[i + 1], c[j], c[j + 1]
      if ay ~= by then
        if ay > by then ax, ay, bx, by = bx, by, ax, ay end
        edges[#edges + 1] = { ay, by, ax, (bx - ax) / (by - ay) }
        top, bottom = min(top, ay), max(bottom, by)
      end
    end
  end
  table.sort(edges, function(p, q) return p[1] < q[1] end)
  local runs, active, nxt = {}, {}, 1
  for py = floor(top), math.ceil(bottom) - 1 do
    local cov, lo, hi = {}, 1e9, -1e9
    for k = 0, SUB - 1 do
      local sy = py + (k + 0.5) / SUB
      while edges[nxt] and edges[nxt][1] <= sy do
        active[#active + 1] = edges[nxt]
        nxt = nxt + 1
      end
      local xs = {}
      for i = #active, 1, -1 do
        local e = active[i]
        if e[2] <= sy then table.remove(active, i) else xs[#xs + 1] = e[3] + (sy - e[1]) * e[4] end
      end
      table.sort(xs)
      for i = 1, #xs - 1, 2 do
        local a, b = xs[i], xs[i + 1]
        local ia, ib = floor(a), floor(b)
        lo, hi = min(lo, ia), max(hi, ib)
        if ia == ib then
          cov[ia] = (cov[ia] or 0) + b - a
        else
          cov[ia] = (cov[ia] or 0) + ia + 1 - a
          for x = ia + 1, ib - 1 do cov[x] = (cov[x] or 0) + 1 end
          cov[ib] = (cov[ib] or 0) + b - ib
        end
      end
    end
    local function shade(x) return floor((cov[x] or 0) / SUB * LEVELS + 0.5) end
    local x = lo
    while x <= hi do
      local e = x
      while e < hi and shade(e + 1) == shade(x) do e = e + 1 end
      if shade(x) > 0 then runs[#runs + 1] = { x, py, e - x + 1, shade(x) } end
      x = e + 1
    end
  end
  return runs
end

-- A spoke: a capsule from radius INNER to r (0.1 units) at angle a, hw pixels either side of its axis.
local function capsule(a, r, hw)
  local c, sn, pts = math.cos(a), math.sin(a), {}
  for _, e in ipairs({ { r, a - pi / 2 }, { INNER, a + pi / 2 } }) do
    local cx, cy = OX + c * e[1] * K, OY + sn * e[1] * K
    for i = 0, 6 do
      local t = e[2] + pi * i / 6
      pts[#pts + 1] = cx + math.cos(t) * hw
      pts[#pts + 1] = cy + math.sin(t) * hw
    end
  end
  return pts
end

-- Which spoke is hollow, and its width and outline (the encoder moves it).
local n, HOLLOW, HW, HO = #SPOKES
for k, p in ipairs(SPOKES) do if p[4] then HOLLOW, HW, HO = k, p[3], p[4] end end

local function spokeRuns(k)
  local p = SPOKES[k]
  local a, hollow = p[1] * pi / 1800, k == HOLLOW
  local hw = max((hollow and HW or STROKE) / 2 * K, LEVELS == 1 and 0.5 or 0)
  if not hollow then return raster({ capsule(a, p[2], hw) }) end
  local o = max(HO / 2 * K, LEVELS == 1 and 0.5 or 0) -- its outline, a ring between two capsules (1 px at least on 1-bit)
  return raster({ capsule(a, p[2], hw + o), capsule(a, p[2], max(hw - o, 0.1)) })
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

local function paint(runs, pal)
  for _, r in ipairs(runs) do g:fillRect(r[1], r[2], r[3], 1, pal[r[4]]) end
end

-- The intro: four spokes a tick, clockwise from the hollow one, then the words fade in. E-paper
-- gets the end of it in one frame.
local step, start, drawn, words
local FADE = LEVELS == 1 and 1 or 6 -- 1-bit can't fade

local function advance()
  local from = step * (paper and n or 4)
  local f = paper and FADE + step or step - math.ceil(n / 4) + 1
  if from >= n and (f > FADE or not WORDS_SHOWN) then return end
  for i = from, min(n, from + (paper and n or 4)) - 1 do
    local k = (start - 1 + i) % n + 1
    drawn[k] = true
    paint(spokeRuns(k), INK)
  end
  if f > 0 and WORDS_SHOWN then
    words = words or wordRuns()
    paint(words, palette(f / FADE))
  end
  step = step + 1
  g:flip()
end

local function restart()
  step, start, drawn = 0, HOLLOW, {}
  g:fillScreen(BG)
  advance()
end

-- Make spoke `to` the hollow one: erase both, then redraw them and their neighbours (their edges
-- share pixels), leaving any the intro hasn't reached yet.
local function move(to)
  local old = HOLLOW
  if to == old then return end
  for _, k in ipairs({ old, to }) do
    if drawn[k] then paint(spokeRuns(k), ERASE) end
  end
  HOLLOW = to
  for _, k in ipairs({ old - 1, old, old + 1, to - 1, to, to + 1 }) do
    k = (k - 1) % n + 1
    if drawn[k] then paint(spokeRuns(k), INK) end
  end
  g:flip()
end

-- The encoder by default; any part can drive it in Connections. Only on Bench (or the mirror).
local spoke = dial and dial.new("spoke", { label = "Hollow spoke", via = "encoder", min = 1, max = n, start = HOLLOW, wrap = true })

function init(ctx) restart() end
function on_tick(ctx, dt_ms) advance() end
function on_event(ctx, e)
  if e.name == "tap" and e.data.index == 0 then restart() end
  if e.name == "dial" then move(spoke:value()) end
end
