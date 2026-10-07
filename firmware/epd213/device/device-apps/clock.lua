local g = lgfx.bind("main")
local shown = nil

local function draw(hhmm, date)
  g:fillScreen(0xFFFFFF)
  g:setTextColor(0x000000)
  g:setTextDatum(lgfx.MC_DATUM)
  g:setTextSize(3); g:drawString(hhmm, g:width() // 2, 110)
  g:setTextSize(1); g:drawString(date, g:width() // 2, 140)
  g:flip()
end

function on_tick(ctx)
  if not datetime.synced() then return end   -- 1970 until Wi-Fi sets the clock
  local now = datetime.now()                 -- UTC on this board
  local hhmm = now:strftime("%H:%M")
  if hhmm ~= shown then               -- only flip when the minute changes
    shown = hhmm
    draw(hhmm, now:strftime("%a %d %b"))
  end
end
