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

  canvas = new GFXcanvas16(WIDTH, HEIGHT);
  return canvas && canvas->getBuffer();
}

void present() {
  uint32_t t0 = micros();
  tft.drawRGBBitmap(0, 0, canvas->getBuffer(), WIDTH, HEIGHT);
  _lastPushUs = micros() - t0;
}

void setBrightness(float v) {
  _brightness = constrain(v, 0.0f, 1.0f);
  ledcWrite(PIN_BL, (uint32_t)(_brightness * 255.0f + 0.5f));
}

float brightness() { return _brightness; }

uint32_t lastPushUs() { return _lastPushUs; }

void Panel::blit(int32_t x, int32_t y, int32_t w, int32_t h, const uint16_t* px) {
  uint16_t* buf = canvas->getBuffer();
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
