-- Scrolling text: "porous.systems bench" gliding right to left across the matrix. Speed sets the pace; A cycles the colour (rainbow first).
-- @output matrix
local g = lgfx.bind("main")
local W, H = g:width(), g:height()
local speed = dial.new("speed", { min = 1, max = 12, start = 4 }) -- × 5 px/s

local TEXT = "porous.systems bench"
-- The built-in font: 6 px per character at size 1, 5×7 glyphs. Twice the size where it fits (16×16).
local SIZE = H >= 16 and 2 or 1
local CW = 6 * SIZE
local TW = #TEXT * CW - SIZE -- no trailing gap after the last glyph
local Y = (H - 7 * SIZE) // 2 -- vertically centred
local GAP = W // 2 + CW -- blank run before the text comes round again

local COLOURS = { "rainbow", 0xFF3020, 0xFF9000, 0xFFE000, 0x30FF40, 0x00D0FF, 0x4060FF, 0xD040FF, 0xFFFFFF }
local mode = 1
local pos = W -- left edge of the text, sub-pixel
local hue = 0

leds.brightness(80)

leds.on_frame(function(ctx, dt_ms)
  pos = pos - speed:value() * 5 * dt_ms / 1000
  if pos < -TW - GAP + W then pos = pos + TW + GAP end
  hue = (hue + dt_ms * 0.06) % 360

  g:fillScreen(0x000000)
  g:setTextSize(SIZE)
  local c = COLOURS[mode]
  -- Draw the text, and its next lap trailing behind when the tail end is on screen.
  for lap = 0, 1 do
    local x0 = math.floor(pos) + lap * (TW + GAP)
    if x0 < W and x0 + TW > 0 then
      for i = 1, #TEXT do
        local x = x0 + (i - 1) * CW
        if x > -CW and x < W then -- only the glyphs that touch the matrix
          if c == "rainbow" then
            g:setTextColor(leds.hsv(hue + x * 360 / (W * 2), 1, 1))
          else
            g:setTextColor(c)
          end
          g:drawString(TEXT:sub(i, i), x, Y)
        end
      end
    end
  end
  g:flip()
end)

function on_event(ctx, e)
  if e.name == "tap" and e.data.index == 0 then
    mode = mode % #COLOURS + 1
  end
end
