#include "Lcd.h"
#include <SPI.h>
#include <Adafruit_ST7789.h>

namespace Lcd {

// Wiring, fixed on the board.
static constexpr int PIN_MOSI = 38, PIN_SCLK = 39, PIN_MISO = 40;  // MISO only reaches the TF card
static constexpr int PIN_CS = 45, PIN_DC = 42, PIN_BL = 1;  // the LCD's reset isn't wired
static constexpr int PIN_SD_CS = 41;
static constexpr uint32_t SPI_HZ = 80000000;  // as Waveshare's demo runs it

static Adafruit_ST7789 tft(&SPI, PIN_CS, PIN_DC, -1);  // -1: software reset (0x01)
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

  tft.init(WIDTH, HEIGHT);  // SWRESET, INVON; 240x320 has no RAM offset
  tft.setSPISpeed(SPI_HZ);
  tft.setRotation(2);       // the panel's native scan (MADCTL 0x00): USB-C at the bottom
  tft.fillScreen(ST77XX_BLACK);

  // Backlight: plain PWM, dark until driven; 10 kHz, 10-bit, as Waveshare runs it.
  ledcSetup(0, 10000, 10);
  ledcAttachPin(PIN_BL, 0);
  setBrightness(1.0f);

  canvas = new Canvas(WIDTH, HEIGHT);  // 150 KB: Arduino puts big blocks in PSRAM
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

// An app that redraws only what moves pushes only those tiles: a flame over a
// still room is a patch of the screen, not all 150 KB. Each run of tiles along
// a band of 16 rows goes to the panel through its own address window, all in
// one SPI transaction; a run as wide as the screen is one stretch of the canvas.
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
      int x0 = a * Canvas::TILE, y0 = band * Canvas::TILE, w = (b - a + 1) * Canvas::TILE, h = Canvas::TILE;
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
  ledcWrite(0, (uint32_t)(_brightness * 1023.0f + 0.5f));
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
  // Clip to the canvas, then copy row by row, back to the canvas's native order.
  int32_t x0 = max(x, (int32_t)0), x1 = min(x + w, (int32_t)WIDTH);
  int32_t r0 = max(y, (int32_t)0), r1 = min(y + h, (int32_t)HEIGHT);
  if (x1 <= x0 || r1 <= r0) return;
  uint16_t* buf = canvas->getBuffer();
  for (int32_t cy = r0; cy < r1; cy++) {
    const uint16_t* src = px + (cy - y) * w + (x0 - x);
    uint16_t* dst = buf + cy * WIDTH + x0;
    for (int32_t n = x1 - x0; n > 0; n--) *dst++ = __builtin_bswap16(*src++);
  }

  uint32_t t0 = micros();
  tft.startWrite();
  if (x0 == x && x1 == x + w && r0 == y && r1 == y + h) {
    tft.setAddrWindow(x, y, w, h);
    tft.writePixels((uint16_t*)px, (uint32_t)w * h, true, true);  // big-endian: out as it is
  } else {  // clipped (LVGL doesn't, but just in case): from the canvas
    tft.setAddrWindow(x0, r0, x1 - x0, r1 - r0);
    for (int32_t cy = r0; cy < r1; cy++) tft.writePixels(buf + cy * WIDTH + x0, x1 - x0, true, false);
  }
  tft.endWrite();
  _pushUs += micros() - t0;
  _pixels += (x1 - x0) * (r1 - r0);
}

void Panel::frameDone() { _frames++; }

}  // namespace Lcd
