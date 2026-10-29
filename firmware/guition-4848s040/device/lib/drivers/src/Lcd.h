// The one frame every drawing path shares: screen.* verbs, lgfx and the status
// text all draw into `canvas`, a 480x480 RGB565 GFXcanvas16 (450 KB, in PSRAM,
// on a 64-byte boundary: a turned push reads it 32 bytes at a time, one cache
// line each; a frame turned through a strip took 36 ms aligned, 44 not).
//
// The panel itself has no memory: the chip scans a second 450 KB frame out to
// it all the time (RgbPanel). A push copies the canvas into that frame, so the
// glass never shows a half-drawn one: present() the whole canvas, presentDirty()
// only the 16x16 tiles drawn since the last push (what lgfx and screen flips
// use); LVGL's flushes land in the canvas and go out together once its frame is
// done.
#pragma once
#include <Arduino.h>
#include <algorithm>
#include <utility>
#include <esp_heap_caps.h>
#include <Adafruit_GFX.h>
#include <ResidentRenderTargets.h>
#include <RgbPanel.h>

namespace Lcd {

constexpr int WIDTH = RgbPanel::WIDTH, HEIGHT = RgbPanel::HEIGHT;

// The canvas notes which 16x16 tiles were drawn since the last push, a bit a
// tile, so a push copies runs of them along each band of 16 rows instead of
// every row from the topmost thing drawn to the bottommost. Everything Adafruit
// GFX draws (text and shapes included) goes through these. Pixels and lines go
// straight into the buffer: Adafruit's lines go pixel by pixel through two
// virtual calls and GFXcanvas16's checks, ~0.5 us a pixel on the board. The
// canvas itself is never turned (the picture is, as it's pushed), so x and y
// are the buffer's.
class Canvas : public GFXcanvas16 {
public:
  static constexpr int W = Lcd::WIDTH, H = Lcd::HEIGHT, TILE = 16, TILES_X = W / TILE, TILES_Y = H / TILE;

  Canvas(uint16_t w, uint16_t h) : GFXcanvas16(w, h, false) {
    buffer = (uint16_t*)heap_caps_aligned_calloc(64, w * h, 2, MALLOC_CAP_SPIRAM);  // never freed
  }
  // Drawing stays inside [clipX0, clipX1) x [clipY0, clipY1): the whole canvas, or lgfx's
  // setClipRect. Every path that writes the buffer stops at it.
  int clipX0 = 0, clipY0 = 0, clipX1 = W, clipY1 = H;
  void setClip(int x, int y, int w, int h) {
    clipX0 = max(x, 0), clipY0 = max(y, 0), clipX1 = min(x + w, W), clipY1 = min(y + h, H);
    if (clipX1 < clipX0) clipX1 = clipX0;
    if (clipY1 < clipY0) clipY1 = clipY0;
  }
  void clearClip() { clipX0 = 0, clipY0 = 0, clipX1 = W, clipY1 = H; }
  bool clipped() const { return clipX0 != 0 || clipY0 != 0 || clipX1 != W || clipY1 != H; }

  void drawPixel(int16_t x, int16_t y, uint16_t c) override {
    if (x < clipX0 || x >= clipX1 || y < clipY0 || y >= clipY1) return;
    buffer[y * W + x] = c;
    dirty[y / TILE] |= 1u << (x / TILE);
  }
  void writePixel(int16_t x, int16_t y, uint16_t c) override { Canvas::drawPixel(x, y, c); }  // circles, text
  void fillScreen(uint16_t c) override {
    if (clipped()) return fillRect(clipX0, clipY0, clipX1 - clipX0, clipY1 - clipY0, c);
    markRect(0, 0, W - 1, H - 1);
    GFXcanvas16::fillScreen(c);
  }
  // As Adafruit's: a negative length runs the other way from x or y.
  void drawFastVLine(int16_t x, int16_t y, int16_t h, uint16_t c) override { fillRect(x, y, 1, h, c); }
  void drawFastHLine(int16_t x, int16_t y, int16_t w, uint16_t c) override {
    if (w < 0) x += w + 1, w = -w;
    fillRect(x, y, w, 1, c);
  }
  // Rectangles row by row, straight into the buffer: Adafruit fills them a
  // column at a time, each column through two virtual calls and its own tile
  // marking (on the C6 a 60x2 span took 50 us, the same pixels as 2x60 14 us).
  // As Adafruit's: nothing for w <= 0, and a negative h fills rows y+h+1 to y.
  void fillRect(int16_t x, int16_t y, int16_t w, int16_t h, uint16_t c) override {
    if (w <= 0 || h == 0) return;
    if (h < 0) y += h + 1, h = -h;
    int x0 = max((int)x, clipX0), y0 = max((int)y, clipY0), x1 = min(x + w, clipX1), y1 = min(y + h, clipY1);
    if (x1 <= x0 || y1 <= y0) return;
    markRect(x0, y0, x1 - 1, y1 - 1);
    for (int r = y0; r < y1; r++) std::fill_n(buffer + r * W + x0, x1 - x0, c);
  }
  void drawLine(int16_t x0, int16_t y0, int16_t x1, int16_t y1, uint16_t c) override;
  // lgfx's pushImage: w x h pixels of RGB565, big-endian, row by row, straight into the buffer.
  // Resident's default draws them a pixel at a time through two virtual calls each; Plenum's iso
  // scenes send every changed 16x16 cell this way. Read a byte at a time: a Lua string's bytes
  // needn't be 2-aligned.
  void pushBE(int x, int y, int w, int h, const uint8_t* be) {
    int x0 = max(x, clipX0), y0 = max(y, clipY0), x1 = min(x + w, clipX1), y1 = min(y + h, clipY1);
    if (x1 <= x0 || y1 <= y0) return;
    markRect(x0, y0, x1 - 1, y1 - 1);
    for (int r = y0; r < y1; r++) {
      const uint8_t* p = be + ((size_t)(r - y) * w + (x0 - x)) * 2;
      uint16_t* d = buffer + r * W + x0;
      for (int n = x1 - x0; n > 0; n--, p += 2) *d++ = (uint16_t)(p[0] << 8 | p[1]);
    }
  }
  // lgfx's pushImage with a palette: w x h bytes of indices into palette (ncolors colours, RGB565
  // big-endian); an index equal to transparent (-1: none) or past the palette's end isn't drawn.
  void pushIndexed(int x, int y, int w, int h, const uint8_t* idx, const uint8_t* palette, int ncolors,
                   int transparent);

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

bool begin();                  // panel, backlight, canvas; false if either didn't start
void present();                // push the canvas to the glass
void presentDirty();           // push only the tiles drawn since the last push (lgfx and screen flips)
void setBrightness(float v);   // backlight, 0..1 (PWM duty)
float brightness();
uint32_t lastPushUs();
// Since the last call: frames pushed, pixels pushed and push time in total (for the heartbeat).
void takeStats(uint32_t& frames, uint32_t& pixels, uint32_t& pushUs);

// The panel as Resident's screens registry sees it ("main"). blit() takes
// RGB565 big-endian rectangles (LVGL's flushes) into the canvas, in the chip's
// byte order; frameDone() pushes every tile LVGL redrew in that frame at once,
// so the glass shows LVGL's frames whole.
class Panel : public Resident::PanelTarget {
public:
  int32_t width() const override { return WIDTH; }
  int32_t height() const override { return HEIGHT; }
  void blit(int32_t x, int32_t y, int32_t w, int32_t h, const uint16_t* px) override;
  void frameDone() override;
};

extern Panel panel;

}  // namespace Lcd
