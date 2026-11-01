// The one frame buffer every drawing path shares: screen.* verbs, lgfx and
// the status text all draw into `canvas`, a 1-bit 122x250 GFXcanvas1 whose
// buffer is the panel's own RAM layout (16-byte rows, bit = 1 is white),
// clipped to lgfx's setClipRect while an app has one.
//
// present() never touches the panel: it snapshots the canvas and returns, so
// a flip inside a Lua dispatch costs a 4 KB copy, not a 0.2-1.9 s refresh
// (which would also trip the sandbox's 1 s execution deadline). poll(), from
// the display driver's update(), drives the refresh without blocking and
// only ever shows the newest frame; a frame identical to the one on the
// glass is skipped. Every 10th refresh is full, to clear ghosting.
#pragma once
#include <Arduino.h>
#include <Adafruit_GFX.h>
#include <ResidentRenderTargets.h>
#include "Epd213.h"

namespace EpdFrame {

constexpr uint16_t BLACK = 0, WHITE = 1;

// Bench's 1-bit rule: luminance (0.299 R + 0.587 G + 0.114 B) >= 128 is
// white, no dithering.
inline uint16_t ink(uint8_t r, uint8_t g, uint8_t b) {
  return (r * 299u + g * 587u + b * 114u) >= 128u * 1000u ? WHITE : BLACK;
}
inline uint16_t ink(uint32_t rgb888) {
  return ink((rgb888 >> 16) & 0xFF, (rgb888 >> 8) & 0xFF, rgb888 & 0xFF);
}
// RGB565 widened to 8 bits a channel as Bench widens it (rgb565ToRgb, and
// Resident's lgfx: the top bits repeated below), then the same rule.
inline uint16_t ink565(uint16_t c) {
  uint8_t r = (c >> 11) & 0x1F, g = (c >> 5) & 0x3F, b = c & 0x1F;
  return ink(r << 3 | r >> 2, g << 2 | g >> 4, b << 3 | b >> 2);
}

// The canvas, with lgfx's clip: drawing stays inside [clipX0, clipX1) x
// [clipY0, clipY1), the whole canvas unless an app set one. Adafruit GFX draws
// everything (text, shapes, rectangles, lines) through drawPixel and the fast
// lines, so those and fillScreen clip it all. LVGL's blits (Panel::blit) go
// past it, as on the colour boards. The canvas is never turned, so x and y are
// the buffer's.
class Canvas : public GFXcanvas1 {
public:
  static constexpr int W = Epd213::WIDTH, H = Epd213::HEIGHT, ROW = Epd213::ROW_BYTES;

  Canvas() : GFXcanvas1(W, H) {}
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
    plot(x, y, c);
  }
  void fillScreen(uint16_t c) override {
    if (clipped()) return fillRect(clipX0, clipY0, clipX1 - clipX0, clipY1 - clipY0, c);
    GFXcanvas1::fillScreen(c);
  }
  // As Adafruit's: a negative length runs the other way from x or y.
  void drawFastVLine(int16_t x, int16_t y, int16_t h, uint16_t c) override {
    if (h < 0) y += h + 1, h = -h;
    if (x < clipX0 || x >= clipX1) return;
    int y0 = max((int)y, clipY0), y1 = min(y + h, clipY1);
    if (y1 > y0) GFXcanvas1::drawFastVLine(x, y0, y1 - y0, c);
  }
  void drawFastHLine(int16_t x, int16_t y, int16_t w, uint16_t c) override {
    if (w < 0) x += w + 1, w = -w;
    if (y < clipY0 || y >= clipY1) return;
    int x0 = max((int)x, clipX0), x1 = min(x + w, clipX1);
    if (x1 > x0) GFXcanvas1::drawFastHLine(x0, y, x1 - x0, c);
  }
  // lgfx's pushImage: w x h pixels of RGB565, big-endian, row by row, each
  // through ink565. A Lua string's bytes needn't be 2-aligned: read a byte at
  // a time.
  void pushBE(int x, int y, int w, int h, const uint8_t* be) {
    int x0 = max(x, clipX0), y0 = max(y, clipY0), x1 = min(x + w, clipX1), y1 = min(y + h, clipY1);
    for (int r = y0; r < y1; r++) {
      const uint8_t* p = be + ((size_t)(r - y) * w + (x0 - x)) * 2;
      for (int c = x0; c < x1; c++, p += 2) plot(c, r, ink565((uint16_t)(p[0] << 8 | p[1])));
    }
  }
  // lgfx's pushImage with a palette: w x h bytes of indices into palette
  // (ncolors colours, RGB565 big-endian), each colour through ink565 once; an
  // index equal to transparent (-1: none) or past the palette's end isn't
  // drawn.
  void pushIndexed(int x, int y, int w, int h, const uint8_t* idx, const uint8_t* palette, int ncolors,
                   int transparent) {
    int x0 = max(x, clipX0), y0 = max(y, clipY0), x1 = min(x + w, clipX1), y1 = min(y + h, clipY1);
    if (x1 <= x0 || y1 <= y0) return;
    uint8_t inks[256];  // BLACK, WHITE, or 2: not drawn
    for (int i = 0; i < ncolors; i++) {
      inks[i] = i == transparent ? 2 : ink565((uint16_t)(palette[i * 2] << 8 | palette[i * 2 + 1]));
    }
    for (int r = y0; r < y1; r++) {
      const uint8_t* s = idx + (size_t)(r - y) * w + (x0 - x);
      for (int c = x0; c < x1; c++) {
        int i = *s++;
        if (i < ncolors && inks[i] != 2) plot(c, r, inks[i]);
      }
    }
  }
  // A pixel known to be on the canvas, straight into the buffer.
  void plot(int x, int y, uint16_t c) {
    uint8_t* p = buffer + y * ROW + (x >> 3);
    if (c) *p |= 0x80 >> (x & 7);
    else *p &= ~(0x80 >> (x & 7));
  }
};

extern Canvas canvas;
extern Epd213 epd;

void begin();
void present(bool forceFull = false);  // snapshot the canvas; refresh soon
void presentNow();                     // present and wait for the glass
void poll();                           // drive refreshes; call every loop
bool busy();                           // a refresh is running
bool pending();                        // a presented frame isn't on the glass yet

// The panel as Resident's screens registry sees it ("main"). blit() takes
// RGB565 (big-endian) and thresholds it into the canvas; frameDone() presents.
class Panel : public Resident::PanelTarget {
public:
  int32_t width() const override { return Epd213::WIDTH; }
  int32_t height() const override { return Epd213::HEIGHT; }
  void blit(int32_t x, int32_t y, int32_t w, int32_t h, const uint16_t* px) override;
  void frameDone() override { present(); }
};

extern Panel panel;

}  // namespace EpdFrame
