local g = lgfx.bind("main")
local n = 0

local function draw()
  g:fillScreen(0xFFFFFF)
  g:setTextColor(0x000000)
  g:setTextDatum(lgfx.TC_DATUM); g:setTextSize(2)
  g:drawString("taps", g:width() // 2, 20)
  g:setTextDatum(lgfx.MC_DATUM); g:setTextSize(5)
  g:drawString(tostring(n), g:width() // 2, 125)
  g:flip()
end

function init(ctx) draw() end

function on_event(ctx, e)
  if e.name == "tap" then n = n + 1; draw()
  elseif e.name == "hold" and e.data.held then n = 0; draw() end
end
