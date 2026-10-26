// The one frame buffer every drawing path shares: screen.* verbs, lgfx and
// the status text all draw into `canvas`, a 172x320 RGB565 GFXcanvas16
// (110 KB, allocated before Wi-Fi so it gets one contiguous block; the C6 has
// no PSRAM).
//
// Pushes go to the ST7789V3 at 80 MHz, inside the caller's Lua dispatch (well
// under the sandbox's 1 s deadline): present() the whole canvas (~32 ms),
// presentDirty() only the 16x16 tiles drawn since the last push (what lgfx and
// screen flips use). There's no second buffer to push from in the background: that
// would cost another 110 KB, which the C6 doesn't have next to Wi-Fi, TLS
// and Lua.
#pragma once
#include <Arduino.h>
#include <utility>
#include <Adafruit_GFX.h>
#include <ResidentRenderTargets.h>

namespace Lcd {

constexpr int WIDTH = 172, HEIGHT = 320;

// The canvas notes which 16x16 tiles were drawn since the last push, a bit a
// tile (the last column of tiles is 12 pixels wide), so a push sends runs of
// them along each band of 16 rows instead of every row from the topmost thing
// drawn to the bottommost. Everything Adafruit GFX draws (text and shapes
// included) goes through these. Pixels and lines go straight into the buffer:
// Adafruit's lines go pixel by pixel through two virtual calls and
// GFXcanvas16's checks. The canvas is never turned, so x and y are the buffer's.
class Canvas : public GFXcanvas16 {
public:
  static constexpr int W = Lcd::WIDTH, H = Lcd::HEIGHT, TILE = 16;
  static constexpr int TILES_X = (W + TILE - 1) / TILE, TILES_Y = (H + TILE - 1) / TILE;

  Canvas(uint16_t w, uint16_t h) : GFXcanvas16(w, h) {}
  void drawPixel(int16_t x, int16_t y, uint16_t c) override {
    if ((unsigned)x >= (unsigned)W || (unsigned)y >= (unsigned)H) return;
    buffer[y * W + x] = c;
    dirty[y / TILE] |= 1u << (x / TILE);
  }
  void writePixel(int16_t x, int16_t y, uint16_t c) override { Canvas::drawPixel(x, y, c); }  // circles, text
  void fillScreen(uint16_t c) override { markRect(0, 0, W - 1, H - 1); GFXcanvas16::fillScreen(c); }
  void drawFastVLine(int16_t x, int16_t y, int16_t h, uint16_t c) override {
    markRect(x, y, x, y + h - 1);
    GFXcanvas16::drawFastVLine(x, y, h, c);
  }
  void drawFastHLine(int16_t x, int16_t y, int16_t w, uint16_t c) override {
    markRect(x, y, x + w - 1, y);
    GFXcanvas16::drawFastHLine(x, y, w, c);
  }
  void drawLine(int16_t x0, int16_t y0, int16_t x1, int16_t y1, uint16_t c) override;

  // The tiles under a rectangle (corners either way round), clipped to the canvas.
  void markRect(int x0, int y0, int x1, int y1) {
    if (x1 < x0) std::swap(x0, x1);
    if (y1 < y0) std::swap(y0, y1);
    x0 = max(x0, 0), y0 = max(y0, 0), x1 = min(x1, W - 1), y1 = min(y1, H - 1);
    if (x1 < x0 || y1 < y0) return;
    uint32_t bits = (2u << (x1 / TILE)) - (1u << (x0 / TILE));
    for (int t = y0 / TILE; t <= y1 / TILE; t++) dirty[t] |= bits;
  }
  uint32_t dirty[TILES_Y] = {};  // per band of 16 rows, a bit per 16 columns
};

extern GFXcanvas16* canvas;

inline uint16_t rgb565(uint8_t r, uint8_t g, uint8_t b) {
  return ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3);
}
inline uint16_t rgb565(uint32_t rgb888) {
  return rgb565((rgb888 >> 16) & 0xFF, (rgb888 >> 8) & 0xFF, rgb888 & 0xFF);
}

bool begin();                  // panel, backlight, canvas; false if the canvas didn't fit
void present();                // push the canvas to the glass
void presentDirty();           // push only the tiles drawn since the last push (lgfx and screen flips)
void setBrightness(float v);   // backlight, 0..1 (PWM duty)
float brightness();
uint32_t lastPushUs();
// Since the last call: frames pushed, pixels pushed and push time in total (for the heartbeat).
void takeStats(uint32_t& frames, uint32_t& pixels, uint32_t& pushUs);

// The panel as Resident's screens registry sees it ("main"). blit() takes
// RGB565 big-endian rectangles into the canvas; frameDone() pushes the tiles
// they covered.
class Panel : public Resident::PanelTarget {
public:
  int32_t width() const override { return WIDTH; }
  int32_t height() const override { return HEIGHT; }
  void blit(int32_t x, int32_t y, int32_t w, int32_t h, const uint16_t* px) override;
  void frameDone() override { presentDirty(); }
};

extern Panel panel;

}  // namespace Lcd
