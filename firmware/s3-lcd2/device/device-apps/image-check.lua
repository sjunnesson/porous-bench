-- Image check: lgfx pushImage (RGB565, and through a palette with a transparent index) and the clip rectangle, as Bench draws them. Compare with the same app in Bench. Fits a 172 px wide screen, a round one, and the C6's arena.
local g = lgfx.bind("main")
local s = screens.get("main")
local W, H = g:width(), g:height()
-- Inside the glass: a round screen shows only its circle.
local round = s.shape == "round"
local ox, oy = round and 50 or 4, round and 40 or 4

-- RGB565, big-endian, as pushImage takes it.
local function be(c) return string.char(c >> 8, c & 0xFF) end
local function rgb(r, gg, b) return ((r >> 3) << 11) | ((gg >> 2) << 5) | (b >> 3) end

-- A 32×32 block: red across, blue down.
local block = {}
for y = 0, 31 do
  for x = 0, 31 do block[#block + 1] = be(rgb(x * 8, 0, y * 8)) end
end
block = table.concat(block)

-- A 32×32 indexed sprite: a ring of colour 1 and 2 around a hole (index 0, transparent), and
-- index 5 in the corners, past the end of the 4-colour palette, which isn't drawn either.
local idx = {}
for y = 0, 31 do
  for x = 0, 31 do
    local d = math.sqrt((x - 15.5) ^ 2 + (y - 15.5) ^ 2)
    local i = (d > 15) and 5 or (d < 8) and 0 or (d < 12) and 1 or 2
    idx[#idx + 1] = string.char(i)
  end
end
idx = table.concat(idx)
local palette = be(rgb(0, 0, 0)) .. be(rgb(255, 200, 0)) .. be(rgb(0, 200, 120)) .. be(rgb(255, 255, 255))

local function label(x, y, text)
  g:setTextColor(0xFFFFFF)
  g:setTextSize(1)
  g:setCursor(x, y)
  g:print(text)
end

function init(ctx)
  g:fillScreen(0x202020)
  local ok = type(g.pushImage) == "function" and type(g.setClipRect) == "function"
  label(ox, oy, ok and "images + clip: ok" or "pushImage/clip MISSING")
  if not ok then g:flip() return end

  -- 1. A plain block, and one half off the right edge (off the glass on a round screen).
  g:pushImage(ox, oy + 12, 32, 32, block)
  g:pushImage(W - 16, oy + 12, 32, 32, block)

  -- 2. The sprite over stripes: its hole and corners show the stripes.
  for i = 0, 7 do g:fillRect(ox + 40 + i * 4, oy + 12, 2, 32, 0x4060FF) end
  g:pushImage(ox + 40, oy + 12, 32, 32, idx, palette, 0)

  -- 3. A clip: everything here is cut to the box drawn round it afterwards.
  local cx, cy = ox, oy + 52
  g:setClipRect(cx, cy, 100, 60)
  g:fillScreen(0x600000)
  g:drawLine(0, cy - 10, W, cy + 70, 0xFFFF00)
  g:drawLine(0, cy + 30, W, cy + 30, 0x00FFFF)
  g:fillCircle(cx, cy, 20, 0x00FF00)
  g:setTextColor(0xFFFFFF)
  g:setTextSize(2)
  g:drawString("clipped text", cx - 20, cy + 40)
  screen.fill_rect(cx + 80, cy - 10, 60, 30, 255, 0, 255)
  g:pushImage(cx + 80, cy + 40, 32, 32, block)
  g:clearClipRect()
  g:drawRect(cx - 1, cy - 1, 102, 62, 0xFFFFFF) -- the clip's edge: nothing may cross it

  -- 4. Timing: forty W×20 pushes from one string.
  local row = string.rep(be(rgb(40, 40, 40)), W * 20)
  local t0 = time.ticks_ms()
  for i = 1, 40 do g:pushImage(0, cy + 70 + (i % 2) * 2, W, 20, row) end
  local ms = time.ticks_ms() - t0
  label(ox, cy + 96, string.format("push %dx20 %.2f ms", W, ms / 40))
  log.info(string.format("[image-check] push %dx20: %.2f ms each", W, ms / 40))
  g:flip()
end
