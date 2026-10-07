#include "ScreenDriver.h"
#include "EpdFrame.h"
#include "BoardConfig.h"
#include "qrcode.h"

extern "C" {
  #include "lua/lua.h"
  #include "lua/lualib.h"
  #include "lua/lauxlib.h"
}

using namespace EpdFrame;

// Channel arguments, 0-255; missing trailing ones take the default.
static uint16_t inkArgs(lua_State* L, int idx, int def) {
  int r = (int)luaL_optinteger(L, idx, def);
  int g = (int)luaL_optinteger(L, idx + 1, def);
  int b = (int)luaL_optinteger(L, idx + 2, def);
  return ink(constrain(r, 0, 255), constrain(g, 0, 255), constrain(b, 0, 255));
}
static int argi(lua_State* L, int idx) { return (int)luaL_checknumber(L, idx); }

void ScreenDriver::update() { EpdFrame::poll(); }

void ScreenDriver::onAppReset() {
  canvas.fillScreen(WHITE);  // each app starts on blank paper
}

// Resident's status strings: "WiFi...", "Configure WiFi\n\n<AP>",
// "Connecting...", the idle screen "Connected\nDevice ID: <id>\nType: epd213"
// (with a countdown line while a saved app waits to load), an app's
// description on load.
void ScreenDriver::displayText(const char* text) {
  Serial.printf("[status] %s\n", text);
  if (_appRunning) return;
  const int W = Epd213::WIDTH;
  canvas.fillScreen(WHITE);
  canvas.setTextColor(BLACK);
  canvas.setTextWrap(true);

  canvas.setTextSize(2);
  canvas.setCursor(4, 6);
  canvas.print("Resident");
  canvas.setTextSize(1);
  canvas.setCursor(4, 26);
  canvas.print("2.13\" e-Paper");
  canvas.drawFastHLine(0, 38, W, BLACK);

  int y = 48;
  String all(text);
  int start = 0;
  bool first = true;
  while (start <= (int)all.length()) {
    int nl = all.indexOf('\n', start);
    String line = all.substring(start, nl < 0 ? all.length() : nl);
    start = nl < 0 ? all.length() + 1 : nl + 1;

    if (line.startsWith("Device ID: ")) {
      canvas.setTextSize(1);
      canvas.setCursor(4, y);
      canvas.print("Device ID");
      y += 12;
      canvas.fillRect(0, y - 3, W, 22, BLACK);  // the string to read off
      canvas.setTextColor(WHITE);
      canvas.setTextSize(2);
      canvas.setCursor(4, y);
      canvas.print(line.substring(11));
      canvas.setTextColor(BLACK);
      y += 26;
    } else {
      // A short first line is the headline; everything else is small.
      uint8_t size = (first && line.length() <= 10) ? 2 : 1;
      canvas.setTextSize(size);
      canvas.setCursor(4, y);
      canvas.print(line);
      int lineH = 8 * size + 4;
      int chars = (W - 4) / (6 * size);
      y += lineH * max(1, (int)((line.length() + chars - 1) / chars));
      if (line.length() == 0) y -= lineH / 2;
    }
    first = false;
  }
  presentNow();  // outside Lua: the status should be on the glass when we return
}

Resident::Screen ScreenDriver::screen(int i) const {
  (void)i;
  Resident::Screen s;
  s.name = "main";
  s.target = &EpdFrame::panel;
  s.shape = "rect";
  s.depth = 1;
  s.dpi = 130;        // 122 px across 23.7 mm of glass
  s.scheme = "light";
  return s;
}

// screens.get("main") extras, as Bench reports them.
void ScreenDriver::getScreen(int i, lua_State* L) {
  (void)i;
  lua_pushstring(L, EPD_MODEL);
  lua_setfield(L, -2, "model");
  lua_pushstring(L, EPD_CONTROLLER);
  lua_setfield(L, -2, "controller");
  lua_pushstring(L, "epaper");
  lua_setfield(L, -2, "tech");
  lua_pushboolean(L, EpdFrame::busy());
  lua_setfield(L, -2, "busy");
  lua_pushboolean(L, EpdFrame::pending());
  lua_setfield(L, -2, "pending");
}

// screens.refresh("main"): a full refresh of the current frame.
bool ScreenDriver::refresh(int i) {
  (void)i;
  present(/*forceFull=*/true);
  return true;
}

// screen.clear([r, g, b]) — default black
int ScreenDriver::clear(lua_State* L) {
  canvas.fillScreen(inkArgs(L, 1, 0));
  return 0;
}

// screen.text(x, y, str[, size = 2[, r, g, b]]) — default white
int ScreenDriver::text(lua_State* L) {
  int x = argi(L, 1), y = argi(L, 2);
  const char* str = luaL_checkstring(L, 3);
  int size = (int)luaL_optinteger(L, 4, 2);
  canvas.setTextColor(inkArgs(L, 5, 255));
  canvas.setTextSize(constrain(size, 1, 16));
  canvas.setCursor(x, y);
  canvas.print(str);
  return 0;
}

int ScreenDriver::fillRect(lua_State* L) {
  canvas.fillRect(argi(L, 1), argi(L, 2), argi(L, 3), argi(L, 4), inkArgs(L, 5, 0));
  return 0;
}

int ScreenDriver::rect(lua_State* L) {
  canvas.drawRect(argi(L, 1), argi(L, 2), argi(L, 3), argi(L, 4), inkArgs(L, 5, 0));
  return 0;
}

int ScreenDriver::line(lua_State* L) {
  canvas.drawLine(argi(L, 1), argi(L, 2), argi(L, 3), argi(L, 4), inkArgs(L, 5, 0));
  return 0;
}

int ScreenDriver::triangle(lua_State* L) {
  canvas.drawTriangle(argi(L, 1), argi(L, 2), argi(L, 3), argi(L, 4), argi(L, 5),
                      argi(L, 6), inkArgs(L, 7, 0));
  return 0;
}

int ScreenDriver::fillTriangle(lua_State* L) {
  canvas.fillTriangle(argi(L, 1), argi(L, 2), argi(L, 3), argi(L, 4), argi(L, 5),
                      argi(L, 6), inkArgs(L, 7, 0));
  return 0;
}

int ScreenDriver::pixel(lua_State* L) {
  canvas.drawPixel(argi(L, 1), argi(L, 2), inkArgs(L, 3, 0));
  return 0;
}

// screen.qr(x, y, text[, scale = 4[, r, g, b]]) — QR v3..v10, ECC low,
// default black modules; the caller clears a light background behind it.
int ScreenDriver::qr(lua_State* L) {
  int x = argi(L, 1), y = argi(L, 2);
  const char* str = luaL_checkstring(L, 3);
  int scale = max(1, (int)luaL_optinteger(L, 4, 4));
  uint16_t c = inkArgs(L, 5, 0);

  static uint8_t buf[512];  // enough for version 10 (~407 bytes)
  QRCode code;
  int8_t result = -1;
  for (uint8_t version = 3; version <= 10 && result != 0; version++)
    result = qrcode_initText(&code, buf, version, ECC_LOW, str);
  if (result != 0) return luaL_error(L, "screen.qr: text too long for QR v10");

  for (uint8_t py = 0; py < code.size; py++)
    for (uint8_t px = 0; px < code.size; px++)
      if (qrcode_getModule(&code, px, py))
        canvas.fillRect(x + px * scale, y + py * scale, scale, scale, c);
  return 0;
}

int ScreenDriver::flip(lua_State* L) {
  (void)L;
  present();
  return 0;
}

// E-paper has no backlight: accepted and ignored.
int ScreenDriver::setBrightness(lua_State* L) {
  luaL_checknumber(L, 1);
  return 0;
}

int ScreenDriver::width(lua_State* L) {
  lua_pushinteger(L, Epd213::WIDTH);
  return 1;
}

int ScreenDriver::height(lua_State* L) {
  lua_pushinteger(L, Epd213::HEIGHT);
  return 1;
}
