#include "Lcd.h"
#include <SPI.h>
#include <Adafruit_ST7789.h>

namespace Lcd {

// Wiring, fixed on the board.
static constexpr int PIN_MOSI = 6, PIN_SCLK = 7, PIN_MISO = 5;  // MISO only reaches the TF card
static constexpr int PIN_CS = 14, PIN_DC = 15, PIN_RST = 21, PIN_BL = 22;
static constexpr int PIN_SD_CS = 4;
static constexpr uint32_t SPI_HZ = 80000000;  // as Waveshare's demo runs it

static Adafruit_ST7789 tft(&SPI, PIN_CS, PIN_DC, PIN_RST);
GFXcanvas16* canvas = nullptr;
Panel panel;

static float _brightness = 1.0f;
static uint32_t _lastPushUs = 0;
static uint32_t _frames = 0, _pixels = 0, _pushUs = 0;

bool begin() {
  // The TF card shares the bus (unused): keep it deselected.
  pinMode(PIN_SD_CS, OUTPUT);
  digitalWrite(PIN_SD_CS, HIGH);
  SPI.begin(PIN_SCLK, PIN_MISO, PIN_MOSI, -1);

  tft.init(WIDTH, HEIGHT);  // 172x320: columns from 34, INVON in the init sequence
  tft.setSPISpeed(SPI_HZ);
  tft.setRotation(2);       // the panel's native scan (MADCTL 0x00): top away from USB-C
  tft.fillScreen(ST77XX_BLACK);

  // Backlight: plain PWM, dark until driven.
  ledcAttach(PIN_BL, 5000, 8);
  setBrightness(1.0f);

  canvas = new Canvas(WIDTH, HEIGHT);
  return canvas && canvas->getBuffer();
}

// Bresenham straight into the buffer, the tiles under the line noted once.
void Canvas::drawLine(int16_t x0, int16_t y0, int16_t x1, int16_t y1, uint16_t c) {
  if (x0 == x1) return drawFastVLine(x0, min(y0, y1), abs(y1 - y0) + 1, c);
  if (y0 == y1) return drawFastHLine(min(x0, x1), y0, abs(x1 - x0) + 1, c);
  markRect(x0, y0, x1, y1);
  int dx = abs(x1 - x0), sx = x0 < x1 ? 1 : -1, dy = -abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
  int err = dx + dy, x = x0, y = y0;
  bool inside = (unsigned)x0 < (unsigned)W && (unsigned)x1 < (unsigned)W && (unsigned)y0 < (unsigned)H &&
                (unsigned)y1 < (unsigned)H;
  uint16_t* buf = buffer;
  for (;;) {
    if (inside || ((unsigned)x < (unsigned)W && (unsigned)y < (unsigned)H)) buf[y * W + x] = c;
    if (x == x1 && y == y1) break;
    int e2 = 2 * err;
    if (e2 >= dy) err += dy, x += sx;
    if (e2 <= dx) err += dx, y += sy;
  }
}

void present() {
  static_cast<Canvas*>(canvas)->markRect(0, 0, WIDTH - 1, HEIGHT - 1);
  presentDirty();
}

// An app that redraws only what moves pushes only those tiles, not all 110 KB.
// Each run of tiles along a band of 16 rows goes to the panel through its own
// address window (the driver adds the panel's 34-column offset), all in one SPI
// transaction; a run as wide as the screen is one stretch of the canvas.
void presentDirty() {
  Canvas* c = static_cast<Canvas*>(canvas);
  uint16_t* buf = c->getBuffer();
  uint32_t t0 = micros(), pixels = 0;
  for (int band = 0; band < Canvas::TILES_Y; band++) {
    uint32_t m = c->dirty[band];
    c->dirty[band] = 0;
    while (m) {
      int a = __builtin_ctz(m), b = a;
      while (b + 1 < Canvas::TILES_X && (m >> (b + 1) & 1)) b++;
      m &= ~((2u << b) - (1u << a));
      int x0 = a * Canvas::TILE, y0 = band * Canvas::TILE;
      int w = min((b + 1) * Canvas::TILE, WIDTH) - x0, h = min(Canvas::TILE, HEIGHT - y0);
      if (!pixels) tft.startWrite();
      tft.setAddrWindow(x0, y0, w, h);
      if (w == WIDTH) tft.writePixels(buf + y0 * WIDTH, w * h, true, false);
      else for (int y = y0; y < y0 + h; y++) tft.writePixels(buf + y * WIDTH + x0, w, true, false);
      pixels += w * h;
    }
  }
  if (!pixels) return;
  tft.endWrite();
  _lastPushUs = micros() - t0;
  _frames++;
  _pixels += pixels;
  _pushUs += _lastPushUs;
}

void setBrightness(float v) {
  _brightness = constrain(v, 0.0f, 1.0f);
  ledcWrite(PIN_BL, (uint32_t)(_brightness * 255.0f + 0.5f));
}

float brightness() { return _brightness; }

uint32_t lastPushUs() { return _lastPushUs; }

void takeStats(uint32_t& frames, uint32_t& pixels, uint32_t& pushUs) {
  frames = _frames;
  pixels = _pixels;
  pushUs = _pushUs;
  _frames = _pixels = _pushUs = 0;
}

void Panel::blit(int32_t x, int32_t y, int32_t w, int32_t h, const uint16_t* px) {
  uint16_t* buf = canvas->getBuffer();
  static_cast<Canvas*>(canvas)->markRect(x, y, x + w - 1, y + h - 1);  // written past drawPixel: mark here
  for (int32_t row = 0; row < h; row++) {
    int32_t cy = y + row;
    if (cy < 0 || cy >= HEIGHT) continue;
    for (int32_t col = 0; col < w; col++) {
      int32_t cx = x + col;
      if (cx < 0 || cx >= WIDTH) continue;
      uint16_t be = px[row * w + col];
      buf[cy * WIDTH + cx] = (uint16_t)((be >> 8) | (be << 8));
    }
  }
}

}  // namespace Lcd
