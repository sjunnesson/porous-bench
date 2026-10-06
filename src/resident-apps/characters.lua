-- Characters: text at three sizes and a walking pixel-art robot. A = jump; Walk speed can be the encoder, the pot or IMU tilt.
local g = lgfx.bind("main")
local s = screens.get("main")
local W, H = g:width(), g:height()
local color = s.depth == 16
local light = s.scheme == "light"
local paper = light -- e-paper: every flip is a refresh, so step once a second
local wait = 0
local BG = light and 0xFFFFFF or 0x000000
local FG = light and 0x000000 or 0xFFFFFF

local speed = dial.new("walk_speed", { label = "Walk speed", min = -6, max = 6, start = 2 })

-- Two-frame walking robot, one letter per colour; '.' is transparent.
local HEAD = {
  "......r.....",
  "......g.....",
  "..########..",
  ".##########.",
  ".##ww##ww##.",
  ".##wp##wp##.",
  ".##########.",
  ".###mmmm###.",
  "..########..",
  "...gggggg...",
  ".g.######.g.",
  "g..######..g",
}
local LEGS = { { "...##..##...", "..gg....gg.." }, { "....#..#....", "....gg.gg..." } }
local PALETTE = color
    and { ["#"] = 0x87CEEB, w = 0xFFFFFF, p = 0x000000, m = 0x000080, g = 0xC0C0C0, r = 0xFF0000 }
    -- 1-bit: body lit, eye sockets and mouth dark, pupils lit.
    or { ["#"] = FG, w = BG, p = FG, m = BG, g = FG, r = FG }
local SW, SH = 12, #HEAD + 2

local LINES = { "Hello!", "Beep boop.", "Nice screen.", "Press A", "to jump!" }

local scale = H >= 200 and 3 or (H >= 100 and 2 or 1)
local x, dir, stride = W / 3, 1, 0
local jumpAt = -1
local textBottom, groundY = 0, H - 3
local line, lastLine = 1, -1e9

local function drawRow(row, px, py, flip)
  for i = 1, SW do
    local c = PALETTE[row:sub(flip and SW + 1 - i or i, flip and SW + 1 - i or i)]
    if c then g:fillRect(px + (i - 1) * scale, py, scale, scale, c) end
  end
end

local function drawRobot(px, py, frame, flip)
  px, py = math.floor(px), math.floor(py)
  for r, row in ipairs(HEAD) do drawRow(row, px, py + (r - 1) * scale, flip) end
  for r, row in ipairs(LEGS[frame]) do drawRow(row, px, py + (#HEAD + r - 1) * scale, flip) end
end

function init(ctx)
  g:fillScreen(BG)
  g:setTextDatum(lgfx.TL_DATUM)
  local y = 2
  local sizes = H >= 200 and { 1, 2, 3 } or (H >= 64 and { 1, 2 } or { 1 })
  local samples = { "ABC abc 0123 !?#", "Size 2", "Big 3" }
  for i, size in ipairs(sizes) do
    g:setTextSize(size)
    g:setTextColor(color and ({ 0xFFD27F, 0x7FFFB2, 0x7FB2FF })[i] or FG)
    g:drawString(samples[i], 2, y)
    y = y + 8 * size + 3
  end
  g:setTextSize(1)
  textBottom = y
  g:drawLine(0, groundY, W - 1, groundY, color and 0x006400 or FG)
  g:flip()
end

function on_tick(ctx, dt_ms)
  if paper then
    wait = wait + dt_ms
    if wait < 1000 then return end
    dt_ms, wait = wait, 0
  end
  local now = ctx.time_ms
  local v = speed:value()
  if v ~= 0 then dir = v > 0 and 1 or -1 end
  local sw, sh = SW * scale, SH * scale

  -- Erase the band the robot can occupy (between the text and the ground).
  g:fillRect(0, textBottom, W, groundY - textBottom, BG)

  x = x + v * 15 * scale * dt_ms / 1000
  if x < -sw then x = x + W + sw end
  if x > W then x = x - W - sw end
  stride = stride + math.abs(v) * 3 * dt_ms / 1000

  local lift = 0
  if jumpAt >= 0 then
    local u = (now - jumpAt) / 600
    if u >= 1 then jumpAt = -1 else lift = math.sin(u * math.pi) * sh * 0.9 end
  end
  local ry = groundY - sh - lift
  local frame = math.floor(stride) % 2 + 1
  drawRobot(x, ry, frame, dir < 0)
  if x + sw > W then drawRobot(x - W - sw, ry, frame, dir < 0) end

  -- Speech bubble.
  if now - lastLine > 2500 then
    lastLine = now
    line = line % #LINES + 1
  end
  local msg = LINES[line]
  local bw = #msg * 6 + 8
  local bx = math.floor(math.min(W - bw - 1, math.max(1, x + sw / 2 - bw / 2)))
  local by = math.floor(ry - 16)
  if by > textBottom then
    g:fillRoundRect(bx, by, bw, 13, 4, light and 0x000000 or 0xFFFFFF)
    g:setTextColor(light and 0xFFFFFF or 0x000000)
    g:drawString(msg, bx + 4, by + 3)
  end
  g:flip()
end

function on_event(ctx, e)
  if e.name == "tap" and e.data.index == 0 and jumpAt < 0 then jumpAt = ctx.time_ms end
end
