#include "Lcd.h"

// How far the picture is turned on the glass, degrees clockwise (platformio.ini).
#ifndef SCREEN_ROTATION
#define SCREEN_ROTATION 0
#endif

namespace Lcd {

GFXcanvas16* canvas = nullptr;
Panel panel;

static uint32_t _lastPushUs = 0;
static uint32_t _frames = 0, _pixels = 0, _pushUs = 0;

bool begin() {
  if (!RgbPanel::begin()) return false;  // ST7701S init, the scan, the backlight
  if (!RgbPanel::setRotation(SCREEN_ROTATION)) Serial.println("[lcd] no RAM to turn the picture: it stays at 0");
  Serial.printf("[lcd] picture turned %d degrees%s\n", RgbPanel::rotation(),
                !RgbPanel::rotation() ? "" : RgbPanel::writesDirect() ? ", straight into the frame" : ", through draw_bitmap");
  canvas = new Canvas(WIDTH, HEIGHT);    // 450 KB: Arduino puts big blocks in PSRAM
  if (!canvas || !canvas->getBuffer()) return false;
  canvas->fillScreen(0);
  present();
  return true;
}

// Bresenham straight into the buffer, the tiles under the line noted once.
void Canvas::drawLine(int16_t x0, int16_t y0, int16_t x1, int16_t y1, uint16_t c) {
  if (x0 == x1) return drawFastVLine(x0, min(y0, y1), abs(y1 - y0) + 1, c);
  if (y0 == y1) return drawFastHLine(min(x0, x1), y0, abs(x1 - x0) + 1, c);
  markRect(x0, y0, x1, y1);
  int dx = abs(x1 - x0), sx = x0 < x1 ? 1 : -1, dy = -abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
  int err = dx + dy, x = x0, y = y0;
  auto in = [this](int px, int py) { return px >= clipX0 && px < clipX1 && py >= clipY0 && py < clipY1; };
  bool inside = in(x0, y0) && in(x1, y1);
  uint16_t* buf = buffer;
  for (;;) {
    if (inside || in(x, y)) buf[y * W + x] = c;
    if (x == x1 && y == y1) break;
    int e2 = 2 * err;
    if (e2 >= dy) err += dy, x += sx;
    if (e2 <= dx) err += dx, y += sy;
  }
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
  int x0 = max(x, clipX0), y0 = max(y, clipY0), x1 = min(x + w, clipX1), y1 = min(y + h, clipY1);
  if (x1 <= x0 || y1 <= y0) return;
  if (ncolors != lastCount || transparent != lastTransparent || memcmp(palette, lastBytes, ncolors * 2) != 0) {
    for (int i = 0; i < 256; i++) {
      pal[i] = (i < ncolors && i != transparent) ? (uint32_t)(palette[i * 2] << 8 | palette[i * 2 + 1]) : 0x10000u;
    }
    memcpy(lastBytes, palette, ncolors * 2);
    lastCount = ncolors, lastTransparent = transparent;
  }
  markRect(x0, y0, x1 - 1, y1 - 1);
  for (int r = y0; r < y1; r++) {
    const uint8_t* s = idx + (size_t)(r - y) * w + (x0 - x);
    uint16_t* d = buffer + r * W + x0;
    for (int n = x1 - x0; n > 0; n--, d++) {
      uint32_t v = pal[*s++];
      if (v < 0x10000u) *d = (uint16_t)v;
    }
  }
}

void present() {
  static_cast<Canvas*>(canvas)->markRect(0, 0, WIDTH - 1, HEIGHT - 1);
  presentDirty();
}

// An app that redraws only what moves pushes only those tiles: five koi spread
// over the pond are five patches of the screen, not every row between them.
// Each run of tiles along a band of 16 rows goes out as one rectangle, and the
// frame is written back from the cache once, after the last.
void presentDirty() {
  Canvas* c = static_cast<Canvas*>(canvas);
  uint32_t t0 = micros(), pixels = 0;
  RgbPanel::beginBatch();
  for (int band = 0; band < Canvas::TILES_Y; band++) {
    uint32_t m = c->dirty[band];
    c->dirty[band] = 0;
    while (m) {
      int a = __builtin_ctz(m), b = a;
      while (b + 1 < Canvas::TILES_X && (m >> (b + 1) & 1)) b++;
      m &= ~((2u << b) - (1u << a));
      int y0 = band * Canvas::TILE;
      RgbPanel::drawRect(c->getBuffer(), a * Canvas::TILE, y0, (b + 1) * Canvas::TILE - 1, y0 + Canvas::TILE - 1);
      pixels += (b - a + 1) * Canvas::TILE * Canvas::TILE;
    }
  }
  RgbPanel::endBatch();
  if (!pixels) return;
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

void Panel::blit(int32_t x, int32_t y, int32_t w, int32_t h, const uint16_t* px) {
  // Clip to the canvas, then copy row by row, back to the chip's byte order.
  int32_t x0 = max(x, (int32_t)0), x1 = min(x + w, (int32_t)WIDTH);
  int32_t r0 = max(y, (int32_t)0), r1 = min(y + h, (int32_t)HEIGHT);
  if (x1 <= x0 || r1 <= r0) return;
  uint16_t* buf = canvas->getBuffer();
  for (int32_t cy = r0; cy < r1; cy++) {
    const uint16_t* src = px + (cy - y) * w + (x0 - x);
    uint16_t* dst = buf + cy * WIDTH + x0;
    for (int32_t n = x1 - x0; n > 0; n--) *dst++ = __builtin_bswap16(*src++);
  }
  static_cast<Canvas*>(canvas)->markRect(x0, r0, x1 - 1, r1 - 1);
}

// LVGL's frame is whole in the canvas: send its tiles out together.
void Panel::frameDone() { presentDirty(); }

}  // namespace Lcd
