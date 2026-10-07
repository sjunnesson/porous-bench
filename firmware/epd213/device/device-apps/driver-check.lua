-- Exercises every module on the epd213 firmware: lgfx, screen, button, screens.
-- Tap IO12: counter +1 (partial refresh). Hold IO12: toggle a QR code.
local g = lgfx.bind("main")
local s = screens.get("main")
local taps, showQr = 0, false

local function draw()
  local w = g:width()
  g:fillScreen(0xFFFFFF)
  g:setTextColor(0x000000)
  g:setTextDatum(lgfx.TC_DATUM); g:setTextSize(2)
  g:drawString("lgfx", w // 2, 6)
  g:setTextDatum(lgfx.TL_DATUM); g:setTextSize(1)
  g:setCursor(4, 30); g:print(s.w .. "x" .. s.h .. " d" .. s.depth .. " " .. s.scheme)
  g:setCursor(4, 42); g:print(tostring(s.tech) .. " " .. tostring(s.controller))
  g:drawRoundRect(4, 56, w - 8, 40, 6, 0x000000)
  g:setTextDatum(lgfx.MC_DATUM); g:setTextSize(3)
  g:drawString(tostring(taps), w // 2, 76)
  screen.text(4, 104, "screen.text", 1, 0, 0, 0)
  screen.fill_triangle(10, 120, 30, 150, 50, 120, 0, 0, 0)
  g:fillCircle(90, 135, 15, 0x000000)
  g:fillCircle(90, 135, 7, 0xFFFFFF)
  if showQr then screen.qr(32, 162, "porous.systems", 2) end
  screen.text(4, 236, "tap +1   hold: QR", 1, 0, 0, 0)
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
    showQr = not showQr
    draw()
  end
end
