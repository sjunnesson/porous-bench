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
static uint32_t _frames = 0, _rows = 0, _pushUs = 0;

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

void present() {
  Canvas* c = static_cast<Canvas*>(canvas);
  c->y0 = HEIGHT;
  c->y1 = -1;
  presentRows(0, HEIGHT - 1);
}

// An app that redraws only what moves pushes only those rows, not all 110 KB.
void presentDirty() {
  Canvas* c = static_cast<Canvas*>(canvas);
  int y0 = c->y0, y1 = c->y1;
  c->y0 = HEIGHT;
  c->y1 = -1;
  presentRows(y0, y1);
}

void setBrightness(float v) {
  _brightness = constrain(v, 0.0f, 1.0f);
  ledcWrite(PIN_BL, (uint32_t)(_brightness * 255.0f + 0.5f));
}

float brightness() { return _brightness; }

uint32_t lastPushUs() { return _lastPushUs; }

void takeStats(uint32_t& frames, uint32_t& rows, uint32_t& pushUs) {
  frames = _frames;
  rows = _rows;
  pushUs = _pushUs;
  _frames = _rows = _pushUs = 0;
}

void presentRows(int y0, int y1) {
  y0 = max(y0, 0);
  y1 = min(y1, HEIGHT - 1);
  if (y1 < y0) return;
  uint32_t t0 = micros();
  // Whole rows are contiguous in the canvas, so a band goes out as one bitmap.
  // The driver's setAddrWindow adds the panel's 34-column offset, as for a full push.
  tft.drawRGBBitmap(0, y0, canvas->getBuffer() + y0 * WIDTH, WIDTH, y1 - y0 + 1);
  _lastPushUs = micros() - t0;
  _frames++;
  _rows += y1 - y0 + 1;
  _pushUs += _lastPushUs;
}

void Panel::blit(int32_t x, int32_t y, int32_t w, int32_t h, const uint16_t* px) {
  uint16_t* buf = canvas->getBuffer();
  static_cast<Canvas*>(canvas)->mark(y, y + h - 1);  // written past drawPixel: mark the rows here
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
