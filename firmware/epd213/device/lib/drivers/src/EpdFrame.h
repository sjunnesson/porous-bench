// The one frame buffer every drawing path shares: screen.* verbs, lgfx and
// the status text all draw into `canvas`, a 1-bit 122x250 GFXcanvas1 whose
// buffer is the panel's own RAM layout (16-byte rows, bit = 1 is white).
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

extern GFXcanvas1 canvas;
extern Epd213 epd;

// Bench's 1-bit rule: luminance (0.299 R + 0.587 G + 0.114 B) >= 128 is
// white, no dithering.
inline uint16_t ink(uint8_t r, uint8_t g, uint8_t b) {
  return (r * 299u + g * 587u + b * 114u) >= 128u * 1000u ? WHITE : BLACK;
}
inline uint16_t ink(uint32_t rgb888) {
  return ink((rgb888 >> 16) & 0xFF, (rgb888 >> 8) & 0xFF, rgb888 & 0xFF);
}
inline uint16_t ink565(uint16_t c) {
  return ink(((c >> 11) & 0x1F) * 255 / 31, ((c >> 5) & 0x3F) * 255 / 63, (c & 0x1F) * 255 / 31);
}

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
