#include "Lcd.h"

// How far the picture is turned on the glass, degrees clockwise (platformio.ini).
#ifndef SCREEN_ROTATION
#define SCREEN_ROTATION 0
#endif

namespace Lcd {

GFXcanvas16* canvas = nullptr;
Panel panel;

#ifdef BENCH_PROFILE
bool hashFlips = false;
// The same number whichever way the picture is turned in the frame, and the same as a canvas of it gave.
uint32_t Canvas::hash() const {
  const uint16_t* front = frame_[newest_];
  uint32_t h = 2166136261u;
  for (int y = 0; y < H; y++) {
    for (int x = 0; x < W; x++) {
      int fx, fy;
      toFrame(x, y, fx, fy);
      h = (h ^ front[fy * W + fx]) * 16777619u;
    }
  }
  return h;
}
#endif
static uint32_t _lastPushUs = 0;
static uint32_t _frames = 0, _pixels = 0, _pushUs = 0;

bool begin() {
  if (!RgbPanel::begin(Canvas::FRAMES)) return false;  // ST7701S init, the scan and its three frames, the backlight
  RgbPanel::setRotation(SCREEN_ROTATION);    // where a touch lands in the picture
  Canvas* c = new Canvas();
  canvas = c;
  if (!c || !c->begin(RgbPanel::rotation())) return false;
  Serial.printf("[lcd] three frames, flipped at the vertical sync; the picture drawn turned %d degrees\n",
                RgbPanel::rotation());
  canvas->fillScreen(0);
  present();
  return true;
}

bool Canvas::begin(int rotation) {
  rot_ = rotation;
  return RgbPanel::frames(frame_, FRAMES) == FRAMES;
}

// The frame to draw the next picture into: one that is neither on the glass nor waiting to go there
// (of three, one always is free), the one that lacks least. Taken up at the first thing drawn after a
// flip, by when the vertical sync has usually freed the frame the picture before last was in.
void Canvas::open() {
  int best = -1, fewest = 0;
  for (int i = 0; i < FRAMES; i++) {
    if (RgbPanel::inUse(frame_[i])) continue;
    int lacks = 0;
    for (int band = 0; band < TILES_Y; band++) lacks += __builtin_popcount(stale_[i][band]);
    if (best < 0 || lacks < fewest) best = i, fewest = lacks;
  }
  back_ = best < 0 ? (newest_ + 1) % FRAMES : best;  // never, with three
  buf_ = frame_[back_];
  open_ = true;
}

// Tiles of one band over from the newest frame, runs of them a row at a time. The frames are turned
// alike, and a tile's rows start on 32 bytes.
void Canvas::bring(int band, uint32_t bits) {
  const uint16_t* front = frame_[newest_];
  while (bits) {
    int a = __builtin_ctz(bits), b = a;
    while (b + 1 < TILES_X && (bits >> (b + 1) & 1)) b++;
    bits &= ~((2u << b) - (1u << a));
    size_t at = (size_t)band * TILE * W + a * TILE, bytes = (size_t)(b - a + 1) * TILE * 2;
    for (int r = 0; r < TILE; r++, at += W) memcpy(buf_ + at, front + at, bytes);
  }
}

void Canvas::touch(int band, uint32_t bits) {
  if (!open_) open();
  uint32_t s = stale_[back_][band] & bits;
  if (s) {
    bring(band, s);
    stale_[back_][band] &= ~s;
  }
  dirty_[band] |= bits;
}

// Before a frame rectangle is drawn on (corners inclusive, inside the frame). `covers`: every pixel of
// it will be written, so a stale tile wholly inside it needn't be brought over first.
void Canvas::prepare(int fx0, int fy0, int fx1, int fy1, bool covers) {
  if (!open_) open();
  uint32_t* stale = stale_[back_];
  uint32_t bits = (2u << (fx1 / TILE)) - (1u << (fx0 / TILE));
  int c0 = (fx0 + TILE - 1) / TILE, c1 = (fx1 + 1) / TILE - 1;  // the columns it covers edge to edge
  uint32_t whole = covers && c1 >= c0 ? (2u << c1) - (1u << c0) : 0;
  for (int band = fy0 / TILE; band <= fy1 / TILE; band++) {
    uint32_t s = stale[band] & bits;
    if (s) {
      bool rows = band * TILE >= fy0 && band * TILE + TILE - 1 <= fy1;
      uint32_t need = rows ? s & ~whole : s;
      if (need) bring(band, need);
      stale[band] &= ~bits;
    }
    dirty_[band] |= bits;
  }
}

void Canvas::fillScreen(uint16_t c) {
  if (clipped()) return fillRect(clipX0, clipY0, clipX1 - clipX0, clipY1 - clipY0, c);
  if (!open_) open();
  std::fill_n(buf_, W * H, c);
  for (int band = 0; band < TILES_Y; band++) stale_[back_][band] = 0, dirty_[band] = (1u << TILES_X) - 1;
}

// Rectangles a frame row at a time, straight into the frame.
void Canvas::fillRect(int16_t x, int16_t y, int16_t w, int16_t h, uint16_t c) {
  if (w <= 0 || h == 0) return;
  if (h < 0) y += h + 1, h = -h;
  int x0 = max((int)x, clipX0), y0 = max((int)y, clipY0), x1 = min(x + w, clipX1) - 1, y1 = min(y + h, clipY1) - 1;
  if (x1 < x0 || y1 < y0) return;
  int fx0, fy0, fx1, fy1;
  toFrame(x0, y0, fx0, fy0);
  toFrame(x1, y1, fx1, fy1);
  if (fx1 < fx0) std::swap(fx0, fx1);
  if (fy1 < fy0) std::swap(fy0, fy1);
  prepare(fx0, fy0, fx1, fy1, true);
  for (int r = fy0; r <= fy1; r++) std::fill_n(buf_ + r * W + fx0, fx1 - fx0 + 1, c);
}

// Bresenham straight into the frame: only the tiles it crosses are touched.
void Canvas::drawLine(int16_t x0, int16_t y0, int16_t x1, int16_t y1, uint16_t c) {
  if (x0 == x1) return drawFastVLine(x0, min(y0, y1), abs(y1 - y0) + 1, c);
  if (y0 == y1) return drawFastHLine(min(x0, x1), y0, abs(x1 - x0) + 1, c);
  int dx = abs(x1 - x0), sx = x0 < x1 ? 1 : -1, dy = -abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
  int err = dx + dy, x = x0, y = y0;
  auto in = [this](int px, int py) { return px >= clipX0 && px < clipX1 && py >= clipY0 && py < clipY1; };
  bool inside = in(x0, y0) && in(x1, y1);
  // A step along x or y in the picture is a step in the frame: which way depends on the turn.
  int fx, fy, ax, ay, bx, by;
  toFrame(x, y, fx, fy);
  toFrame(x + sx, y, ax, ay);
  toFrame(x, y + sy, bx, by);
  ax -= fx, ay -= fy, bx -= fx, by -= fy;
  for (;;) {
    if (inside || in(x, y)) store(fx, fy, c);
    if (x == x1 && y == y1) break;
    int e2 = 2 * err;
    if (e2 >= dy) err += dy, x += sx, fx += ax, fy += ay;
    if (e2 <= dx) err += dx, y += sy, fx += bx, fy += by;
  }
}

// Picture pixels x0..x1, y0..y1 (inclusive, clipped already) out of a source whose pixel (x, y) is at
// src and whose rows are w pixels of bpp bytes, into the frame: colour(p) gives a pixel's RGB565, or
// more than 0xFFFF for one that isn't drawn. Turned a quarter, a picture row is a frame column: those
// go 16 frame rows at a time (a strip one tile high), so the source is read along its rows 16 pixels
// at a time and the frame written down 16 rows that stay in the cache.
template <class Colour>
void Canvas::put(int x, int y, int w, int x0, int y0, int x1, int y1, const uint8_t* src, int bpp, Colour colour) {
  auto at = [&](int px, int py) { return src + ((size_t)(py - y) * w + (px - x)) * bpp; };
  switch (rot_) {
    case 90:  // frame (H-1-y, x): frame rows are picture columns x0..x1
      for (int fa = x0; fa <= x1;) {
        int fb = min((fa | (TILE - 1)) + 1, x1 + 1);
        for (int r = y0; r <= y1; r++) {
          const uint8_t* p = at(fa, r);
          uint16_t* d = buf_ + fa * W + (H - 1 - r);
          for (int n = fb - fa; n > 0; n--, p += bpp, d += W) {
            uint32_t v = colour(p);
            if (v < 0x10000u) *d = (uint16_t)v;
          }
        }
        fa = fb;
      }
      break;
    case 270:  // frame (y, W-1-x): frame rows W-1-x1..W-1-x0, the picture's columns backwards
      for (int fa = W - 1 - x1; fa <= W - 1 - x0;) {
        int fb = min((fa | (TILE - 1)) + 1, W - x0);
        for (int r = y0; r <= y1; r++) {
          const uint8_t* p = at(W - 1 - fa, r);
          uint16_t* d = buf_ + fa * W + r;
          for (int n = fb - fa; n > 0; n--, p -= bpp, d += W) {
            uint32_t v = colour(p);
            if (v < 0x10000u) *d = (uint16_t)v;
          }
        }
        fa = fb;
      }
      break;
    default: {  // 0 and 180: a picture row is a frame row, forwards or backwards
      int step = rot_ == 180 ? -1 : 1;
      for (int r = y0; r <= y1; r++) {
        const uint8_t* p = at(x0, r);
        uint16_t* d = rot_ == 180 ? buf_ + (H - 1 - r) * W + (W - 1 - x0) : buf_ + r * W + x0;
        for (int n = x1 - x0 + 1; n > 0; n--, p += bpp, d += step) {
          uint32_t v = colour(p);
          if (v < 0x10000u) *d = (uint16_t)v;
        }
      }
    }
  }
}

void Canvas::pushBE(int x, int y, int w, int h, const uint8_t* be, bool clip) {
  int x0 = max(x, clip ? clipX0 : 0), y0 = max(y, clip ? clipY0 : 0);
  int x1 = min(x + w, clip ? clipX1 : W) - 1, y1 = min(y + h, clip ? clipY1 : H) - 1;
  if (x1 < x0 || y1 < y0) return;
  int fx0, fy0, fx1, fy1;
  toFrame(x0, y0, fx0, fy0);
  toFrame(x1, y1, fx1, fy1);
  prepare(min(fx0, fx1), min(fy0, fy1), max(fx0, fx1), max(fy0, fy1), true);
  put(x, y, w, x0, y0, x1, y1, be, 2, [](const uint8_t* p) { return (uint32_t)(uint16_t)(p[0] << 8 | p[1]); });
}

// The palette as native RGB565, one entry for each byte an index can be, with the indices not
// drawn (transparent, past the end) above 0xFFFF. A cell is drawn from one palette several times
// over (its backdrop, then each sprite), so the last one is kept and only made again when the
// palette's bytes differ.
void Canvas::pushIndexed(int x, int y, int w, int h, const uint8_t* idx, const uint8_t* palette, int ncolors,
                         int transparent) {
  static uint32_t pal[256];
  static uint8_t lastBytes[512];
  static int lastCount = -1, lastTransparent = -2;
  int x0 = max(x, clipX0), y0 = max(y, clipY0), x1 = min(x + w, clipX1) - 1, y1 = min(y + h, clipY1) - 1;
  if (x1 < x0 || y1 < y0) return;
  if (ncolors != lastCount || transparent != lastTransparent || memcmp(palette, lastBytes, ncolors * 2) != 0) {
    for (int i = 0; i < 256; i++) {
      pal[i] = (i < ncolors && i != transparent) ? (uint32_t)(palette[i * 2] << 8 | palette[i * 2 + 1]) : 0x10000u;
    }
    memcpy(lastBytes, palette, ncolors * 2);
    lastCount = ncolors, lastTransparent = transparent;
  }
  int fx0, fy0, fx1, fy1;
  toFrame(x0, y0, fx0, fy0);
  toFrame(x1, y1, fx1, fy1);
  // Every pixel is drawn only if every index is a colour: a hole shows what was there.
  bool covers = ncolors >= 256 && (transparent < 0 || transparent > 255);
  prepare(min(fx0, fx1), min(fy0, fy1), max(fx0, fx1), max(fy0, fy1), covers);
  const uint32_t* table = pal;
  put(x, y, w, x0, y0, x1, y1, idx, 1, [table](const uint8_t* p) { return table[*p]; });
}

// What this frame still lacks comes over from the newest, then it goes on the glass at the next
// vertical sync and is the newest itself. The tiles drawn in it are what the other two now lack.
uint32_t Canvas::flip() {
  uint32_t any = 0;
  for (int band = 0; band < TILES_Y; band++) any |= dirty_[band];
  if (!any) return 0;
  uint32_t pixels = 0;
  for (int band = 0; band < TILES_Y; band++) {
    if (stale_[back_][band]) bring(band, stale_[back_][band]);
    for (int i = 0; i < FRAMES; i++) stale_[i][band] = i == back_ ? 0 : stale_[i][band] | dirty_[band];
    pixels += __builtin_popcount(dirty_[band]) * TILE * TILE;
    dirty_[band] = 0;
  }
  RgbPanel::show(buf_);
  newest_ = back_;
  open_ = false;
  return pixels;
}

void present() { presentDirty(); }

void presentDirty() {
  uint32_t t0 = micros();
  uint32_t pixels = static_cast<Canvas*>(canvas)->flip();
  if (!pixels) return;
#ifdef BENCH_PROFILE
  if (hashFlips) {
    static int n = 0;
    Serial.printf("[hash] %d %08x\n", ++n, (unsigned)static_cast<Canvas*>(canvas)->hash());
  }
#endif
  _lastPushUs = micros() - t0;
  _frames++;
  _pixels += pixels;
  _pushUs += _lastPushUs;
}

void setBrightness(float v) { RgbPanel::setBacklight(v); }

float brightness() { return RgbPanel::backlight(); }

uint32_t lastPushUs() { return _lastPushUs; }

void takeStats(uint32_t& frames, uint32_t& pixels, uint32_t& pushUs) {
  frames = _frames;
  pixels = _pixels;
  pushUs = _pushUs;
  _frames = _pixels = _pushUs = 0;
}

// LVGL's flushes come in the panel's wire order, as pushImage's pixels do, and ignore lgfx's clip.
void Panel::blit(int32_t x, int32_t y, int32_t w, int32_t h, const uint16_t* px) {
  static_cast<Canvas*>(canvas)->pushBE(x, y, w, h, (const uint8_t*)px, false);
}

// LVGL's frame is whole: show it.
void Panel::frameDone() { presentDirty(); }

}  // namespace Lcd
