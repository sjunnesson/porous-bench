-- Driver check: exercises every module on the c6-lcd147 firmware (lgfx, screen, button, screens)
-- Tap BOOT: counter +1. Hold BOOT: toggle a QR code and dim the backlight.
local g = lgfx.bind("main")
local s = screens.get("main")
local taps, holds, alt = 0, 0, false

local function draw()
  local w = g:width()
  g:fillScreen(0x000000)
  g:drawRect(0, 0, w, g:height(), 0x404040)
  g:setTextColor(0xFFFFFF)
  g:setTextDatum(lgfx.TC_DATUM); g:setTextSize(2)
  g:drawString("lgfx", w // 2, 22)
  g:setTextDatum(lgfx.TL_DATUM); g:setTextSize(1)
  g:setTextColor(0xA0A0A0)
  g:setCursor(12, 46); g:print(s.w .. "x" .. s.h .. " d" .. s.depth .. " " .. s.scheme .. " " .. tostring(s.dpi) .. "dpi")
  g:setCursor(12, 58); g:print(tostring(s.tech) .. " " .. tostring(s.controller))
  g:setCursor(12, 70); g:print(string.format("brightness %.2f", screens.get("main").brightness))
  g:drawRoundRect(12, 84, w - 24, 44, 6, 0x00C0FF)
  g:setTextColor(0xFFFFFF)
  g:setTextDatum(lgfx.MC_DATUM); g:setTextSize(3)
  g:drawString(tostring(taps), w // 2, 106)

  -- screen verbs into the same frame
  screen.text(12, 140, "screen.text", 1, 255, 200, 0)
  screen.fill_rect(12, 154, 40, 20, 255, 0, 0)
  screen.fill_rect(66, 154, 40, 20, 0, 255, 0)
  screen.fill_rect(120, 154, 40, 20, 0, 0, 255)
  screen.fill_triangle(20, 186, 40, 216, 60, 186, 255, 0, 255)
  g:fillCircle(120, 200, 16, 0xFFFF00)
  g:fillCircle(120, 200, 8, 0x000000)

  if alt then
    screen.fill_rect(46, 224, 80, 80, 255, 255, 255)
    screen.qr(57, 235, "porous.systems", 2)     -- v3: 29 x 2 = 58 px
  else
    screen.text(12, 236, "holds " .. holds, 2)
  end
  screen.text(12, 296, "tap +1  hold: QR", 1, 128, 128, 128)
  g:flip()
end

function init(ctx)
  log.info("driver-check on " .. tostring(s.model))
  draw()
end

function on_event(ctx, e)
  if e.name == "tap" then
    taps = e.data.count
    draw()
  elseif e.name == "hold" and e.data.held then
    holds = holds + 1
    alt = not alt
    screens.set("main", { brightness = alt and 0.3 or 1.0 })
    draw()
  end
end
