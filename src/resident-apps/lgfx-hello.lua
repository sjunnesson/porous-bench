-- lgfx hello: reads the screen's facts from `screens` and adapts (colour or 1-bit, dark or light glass)
local g = lgfx.bind("main")
local s = screens.get("main")
local W, H = g:width(), g:height()
local light = s.scheme == "light"          -- e-paper: blank is the paper
local BG = light and 0xFFFFFF or 0x000000
local FG = light and 0x000000 or 0xFFFFFF
local ACCENT = s.depth == 16 and 0xFF8A3D or FG
local taps = 0
local prev

local function draw(ctx)
  local secs = ctx.time_ms // 1000
  local frame = taps .. "|" .. (light and secs // 10 or secs)
  if frame == prev then return end         -- never flip an unchanged frame
  prev = frame
  g:fillScreen(BG)
  g:fillRoundRect(4, 4, W - 8, 22, 6, ACCENT)
  g:setTextColor(BG)
  g:setTextSize(2)
  g:setTextDatum(lgfx.MC_DATUM)
  g:drawString("Resident", W // 2, 16)
  g:setTextColor(FG)
  g:setTextSize(1)
  g:setTextDatum(lgfx.TL_DATUM)
  g:drawString(W .. "x" .. H .. " " .. s.depth .. "-bit " .. s.scheme, 6, 34)
  g:drawString("up " .. secs .. " s", 6, 46)
  g:drawString("taps " .. taps, 6, 58)
  local r = math.min(W, H) // 6
  g:drawCircle(W - r - 8, H - r - 8, r, FG)
  g:fillCircle(W - r - 8, H - r - 8, math.max(2, (taps * 3) % r), ACCENT)
  g:flip()
end

function init(ctx)
  log.info("screen: " .. W .. "x" .. H .. ", depth " .. s.depth .. ", " .. s.scheme)
  draw(ctx)
end

function on_tick(ctx, dt_ms) draw(ctx) end

function on_event(ctx, e)
  if e.name == "tap" then
    taps = taps + 1
    if buzzer then buzzer.beep(660 + e.data.index * 220, 40) end
    draw(ctx)
  end
end
