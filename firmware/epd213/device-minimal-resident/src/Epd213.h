// Waveshare 2.13" e-Paper, B/W, 122x250 visible, 4-wire SPI.
//
// This board's panel is HINK-E0213A22-A0 (Waveshare's 2.13" V2), controller
// IL3897 / SSD1675A, not the V4's SSD1680: same geometry and RAM layout, but
// its OTP has no fast waveform, so both refreshes load a 70-byte LUT from
// the host (Waveshare's epd2in13_V2 tables, as GxEPD2's GDEH0213B72 driver).
//
// The frame is 1 bit per pixel, rows of 16 bytes (122 px rounded up to 128),
// MSB = leftmost pixel, bit = 1 is white: exactly Adafruit GFXcanvas1's
// layout, so a canvas buffer goes to the panel as is.
#pragma once
#include <Arduino.h>
#include <SPI.h>

class Epd213 {
public:
  static constexpr int WIDTH = 122;
  static constexpr int HEIGHT = 250;
  static constexpr int ROW_BYTES = 16;
  static constexpr int FRAME_BYTES = ROW_BYTES * HEIGHT;  // 4000

  struct Pins { int8_t din, clk, cs, dc, rst, busy; };

  explicit Epd213(const Pins& p) : _p(p), _spi(HSPI) {}

  void begin(uint32_t spiHz = 10000000);

  // Full refresh (~1.7 s, flashes): clears ghosting. Writes the frame to both
  // RAMs, so the next partial refresh diffs against the right "old" image.
  void showFull(const uint8_t* frame);

  // Partial refresh (~0.3 s): new frame to 0x24, refresh, then the same frame
  // to 0x26 so it becomes the base for the next partial.
  void showPartial(const uint8_t* frame);

  // Full refresh every `n` partials (n = 0: never); show() picks for you.
  void setFullEvery(uint8_t n) { _fullEvery = n; }
  void show(const uint8_t* frame);

  void sleep();  // deep sleep; begin() again to wake
  bool busy() const { return digitalRead(_p.busy) == HIGH; }
  uint32_t lastRefreshMs() const { return _lastMs; }

private:
  void reset();
  void waitBusy(uint32_t timeoutMs = 5000);
  void cmd(uint8_t c);
  void data(uint8_t d);
  void dataBuf(const uint8_t* buf, size_t n);
  void setWindowAndCursor();
  void writeRam(uint8_t reg, const uint8_t* frame);
  void initFull();
  void initPartial();
  void powerOn();

  Pins _p;
  SPIClass _spi;
  SPISettings _settings;
  uint8_t _fullEvery = 10;
  uint8_t _partials = 0;
  bool _haveBase = false;
  bool _partMode = false;
  uint32_t _lastMs = 0;
};
