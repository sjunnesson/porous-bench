// The picture every drawing path shares: screen.* verbs, lgfx, LVGL's flushes and the status text all
// draw through `canvas`, a GFXcanvas16 with no buffer of its own.
//
// The panel has no memory: the chip scans a 450 KB frame in PSRAM out to it all the time (RgbPanel).
// There are three such frames. One is on the glass; everything is drawn into another, already turned
// the way the picture is turned, and a flip puts that one on the glass from the next vertical sync.
// So the glass never shows a half-drawn frame, and showing a frame copies nothing: until 2026-11-06 a
// flip copied a canvas into the scanned frame, turning it on the way, 30 ms for a full screen and half
// of what a full-screen app spent (a profile of driver-check: 52% in that copy). The third frame is
// there so drawing never waits: with two, the one just swapped out stays on the glass until the
// vertical sync, up to 24 ms in which nothing could be drawn (5 ms a frame for Patterns, measured).
//
// A frame taken up to draw into is behind the newest picture wherever the frames since its own were
// drawn. Each 16x16 tile drawn in a frame is noted (`dirty`), and at the flip those are tiles the other
// two now lack (`stale`). A stale tile is brought over from the newest frame just before something is
// drawn on part of it, or at the flip if nothing was; a tile about to be covered whole (a clear, a big
// rectangle, an image) isn't copied at all. An app that redraws everything copies nothing.
#pragma once
#include <Arduino.h>
#include <algorithm>
#include <utility>
#include <Adafruit_GFX.h>
#include <ResidentRenderTargets.h>
#include <RgbPanel.h>

namespace Lcd {

constexpr int WIDTH = RgbPanel::WIDTH, HEIGHT = RgbPanel::HEIGHT;

// Everything Adafruit GFX draws (text and shapes included) comes down to the pixels, rectangles and
// lines here, in the picture's own coordinates; each lands in the frame at 0: (x, y), 90: (H-1-y, x),
// 180: (W-1-x, H-1-y), 270: (y, W-1-x), as RgbPanel turns it. Pixels and lines go straight into the
// frame: Adafruit's lines go pixel by pixel through two virtual calls, ~0.5 us a pixel on the board.
class Canvas : public GFXcanvas16 {
public:
  static constexpr int W = Lcd::WIDTH, H = Lcd::HEIGHT, TILE = 16, TILES_X = W / TILE, TILES_Y = H / TILE;
  static constexpr int FRAMES = 3;

  Canvas() : GFXcanvas16(W, H, false) {}  // no buffer: the base class draws nothing itself
  // The panel's three frames, the picture turned `rotation` degrees. False without them.
  bool begin(int rotation);

  // Drawing stays inside [clipX0, clipX1) x [clipY0, clipY1): the whole picture, or lgfx's
  // setClipRect. Every path that draws stops at it, except LVGL's.
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
    int fx, fy;
    toFrame(x, y, fx, fy);
    store(fx, fy, c);
  }
  void writePixel(int16_t x, int16_t y, uint16_t c) override { Canvas::drawPixel(x, y, c); }  // circles, text
  void fillScreen(uint16_t c) override;
  // As Adafruit's: a negative length runs the other way from x or y.
  void drawFastVLine(int16_t x, int16_t y, int16_t h, uint16_t c) override { fillRect(x, y, 1, h, c); }
  void drawFastHLine(int16_t x, int16_t y, int16_t w, uint16_t c) override {
    if (w < 0) x += w + 1, w = -w;
    fillRect(x, y, w, 1, c);
  }
  // As Adafruit's: nothing for w <= 0, and a negative h fills rows y+h+1 to y.
  void fillRect(int16_t x, int16_t y, int16_t w, int16_t h, uint16_t c) override;
  void drawLine(int16_t x0, int16_t y0, int16_t x1, int16_t y1, uint16_t c) override;
  // lgfx's pushImage: w x h pixels of RGB565, big-endian, row by row (read a byte at a time: a Lua
  // string's bytes needn't be 2-aligned). LVGL's flushes come the same way, past the clip.
  void pushBE(int x, int y, int w, int h, const uint8_t* be, bool clip = true);
  // lgfx's pushImage with a palette: w x h bytes of indices into palette (ncolors colours, RGB565
  // big-endian); an index equal to transparent (-1: none) or past the palette's end isn't drawn.
  void pushIndexed(int x, int y, int w, int h, const uint8_t* idx, const uint8_t* palette, int ncolors,
                   int transparent);

  // Show what has been drawn since the last flip, from the next vertical sync on.
  // Returns the pixels in the tiles drawn (0: nothing was, and nothing happens).
  uint32_t flip();
#ifdef BENCH_PROFILE
  uint32_t hash() const;  // of the newest picture, in the picture's own coordinates
#endif

private:
  // The frame pixel of a picture pixel.
  inline void toFrame(int x, int y, int& fx, int& fy) const {
    switch (rot_) {
      case 90: fx = H - 1 - y, fy = x; break;
      case 180: fx = W - 1 - x, fy = H - 1 - y; break;
      case 270: fx = y, fy = W - 1 - x; break;
      default: fx = x, fy = y;
    }
  }
  // A frame pixel written, its tile made ready first if this frame hasn't drawn on it yet.
  inline void store(int fx, int fy, uint16_t c) {
    uint32_t bit = 1u << (fx / TILE);
    if (!(dirty_[fy / TILE] & bit)) touch(fy / TILE, bit);
    buf_[fy * W + fx] = c;
  }
  void touch(int band, uint32_t bits);                                   // before drawing on part of these tiles
  void prepare(int fx0, int fy0, int fx1, int fy1, bool covers);         // before drawing on a frame rectangle
  void bring(int band, uint32_t bits);                                   // stale tiles over from the newest frame
  void open();                                                           // take up a frame to draw into
  template <class Colour>
  void put(int x, int y, int w, int x0, int y0, int x1, int y1, const uint8_t* src, int bpp, Colour colour);

  uint16_t* frame_[FRAMES] = {};
  uint16_t* buf_ = nullptr;  // the frame being drawn into: frame_[back_], once open_
  bool open_ = false;        // a frame has been taken up since the last flip
  int back_ = 1;
  int newest_ = 0;           // the last one shown, complete: the driver starts on frame 0, black like the rest
  int rot_ = 0;
  uint32_t dirty_[TILES_Y] = {};          // tiles drawn on since the last flip: per band of 16 rows, a bit per 16 columns
  uint32_t stale_[FRAMES][TILES_Y] = {};  // tiles each frame lacks, that the newest has
};

extern GFXcanvas16* canvas;
#ifdef BENCH_PROFILE
extern bool hashFlips;  // print a hash of the picture after each flip (Profiler.h's 'h')
#endif

inline uint16_t rgb565(uint8_t r, uint8_t g, uint8_t b) {
  return ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3);
}
inline uint16_t rgb565(uint32_t rgb888) {
  return rgb565((rgb888 >> 16) & 0xFF, (rgb888 >> 8) & 0xFF, rgb888 & 0xFF);
}

bool begin();                  // panel, backlight, canvas; false if either didn't start
void present();                // show what has been drawn (the same as presentDirty: nothing is copied)
void presentDirty();           // show what has been drawn since the last flip (lgfx and screen flips)
void setBrightness(float v);   // backlight, 0..1 (PWM duty)
float brightness();
uint32_t lastPushUs();
// Since the last call: frames shown, pixels in the tiles drawn, and the time flips took in total
// (bringing tiles over; the swap itself costs nothing), for the heartbeat.
void takeStats(uint32_t& frames, uint32_t& pixels, uint32_t& pushUs);

// The panel as Resident's screens registry sees it ("main"). blit() takes RGB565 big-endian
// rectangles (LVGL's flushes) into the frame being drawn; frameDone() flips, so the glass shows
// LVGL's frames whole.
class Panel : public Resident::PanelTarget {
public:
  int32_t width() const override { return WIDTH; }
  int32_t height() const override { return HEIGHT; }
  void blit(int32_t x, int32_t y, int32_t w, int32_t h, const uint16_t* px) override;
  void frameDone() override;
};

extern Panel panel;

}  // namespace Lcd
