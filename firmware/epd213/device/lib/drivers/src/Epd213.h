// Waveshare 2.13" e-Paper, B/W, 122x250 visible, 4-wire SPI.
//
// Two panel generations share the geometry and RAM layout but not the refresh:
//  - V2 (HINK-E0213A22, controller IL3897 / SSD1675A, the Waveshare ESP32
//    e-Paper Driver Board's panel): its OTP has no fast waveform, so both
//    refreshes load a 70-byte LUT from the host (Waveshare's epd2in13_V2
//    tables, as GxEPD2's GDEH0213B72 driver). Verified on hardware.
//  - V4 (SSD1680, today's Waveshare 2.13" module): waveforms from OTP, as
//    Waveshare's epd2in13_V4 and GxEPD2's GDEM0213B74 drivers do it.
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
  enum class Panel : uint8_t { V2 = 2, V4 = 4 };

#if CONFIG_IDF_TARGET_ESP32
  static constexpr uint8_t SPI_BUS = HSPI;
#else
  static constexpr uint8_t SPI_BUS = FSPI;
#endif
  Epd213(const Pins& p, Panel panel) : _p(p), _panel(panel), _spi(SPI_BUS) {}
  Panel panel() const { return _panel; }

  void begin(uint32_t spiHz = 10000000);

  // Full refresh (~1.9 s on the V2, flashes): clears ghosting. Writes the frame to both
  // RAMs, so the next partial refresh diffs against the right "old" image.
  void showFull(const uint8_t* frame);

  // Partial refresh (~0.3 s): new frame to 0x24, refresh, then the same frame
  // to 0x26 so it becomes the base for the next partial.
  void showPartial(const uint8_t* frame);

  // Full refresh every `n` partials (n = 0: never); show() picks for you.
  void setFullEvery(uint8_t n) { _fullEvery = n; }
  void show(const uint8_t* frame);

  // Non-blocking: start() sends the frame and triggers the refresh, then
  // returns; poll() finishes it once BUSY drops and returns true while a
  // refresh is still running. `frame` must stay untouched until poll() returns
  // false (a partial writes it to the old RAM at the end).
  void start(const uint8_t* frame, bool full);
  bool poll();
  bool refreshing() const { return _inFlight != nullptr; }
  bool wantsFull() const { return !_haveBase || (_fullEvery && _partials >= _fullEvery); }

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
  void initFullV4();
  void initPartialV4();
  void powerOn();

  Pins _p;
  Panel _panel;
  SPIClass _spi;
  SPISettings _settings;
  uint8_t _fullEvery = 10;
  uint8_t _partials = 0;
  bool _haveBase = false;
  bool _partMode = false;
  uint32_t _lastMs = 0;
  const uint8_t* _inFlight = nullptr;
  bool _inFlightFull = false;
  uint32_t _startMs = 0;
};
