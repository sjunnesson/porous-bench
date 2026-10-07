#include "EpdFrame.h"
#include "BoardConfig.h"

namespace EpdFrame {

Epd213 epd({EPD_DIN, EPD_CLK, EPD_CS, EPD_DC, EPD_RST, EPD_BUSY},
           EPD_PANEL == 4 ? Epd213::Panel::V4 : Epd213::Panel::V2);
GFXcanvas1 canvas(Epd213::WIDTH, Epd213::HEIGHT);
Panel panel;

static uint8_t pendingFrame[Epd213::FRAME_BYTES];  // newest presented frame
static uint8_t sentFrame[Epd213::FRAME_BYTES];     // the frame on (or going to) the glass
static bool dirty = false;
static bool forceFullNext = false;
static bool everShown = false;

void begin() {
  epd.begin();
  epd.setFullEvery(10);
  canvas.fillScreen(WHITE);
  canvas.setTextWrap(true);
}

void present(bool forceFull) {
  memcpy(pendingFrame, canvas.getBuffer(), Epd213::FRAME_BYTES);
  dirty = true;
  if (forceFull) forceFullNext = true;
}

void poll() {
  if (epd.poll()) return;  // still refreshing
  if (!dirty) return;
  dirty = false;
  if (everShown && !forceFullNext &&
      memcmp(pendingFrame, sentFrame, Epd213::FRAME_BYTES) == 0) return;
  memcpy(sentFrame, pendingFrame, Epd213::FRAME_BYTES);
  bool full = forceFullNext || epd.wantsFull();
  forceFullNext = false;
  everShown = true;
  epd.start(sentFrame, full);
}

void presentNow() {
  present();
  while (epd.poll()) delay(1);
  poll();
  while (epd.poll()) delay(1);
}

bool busy() { return epd.refreshing(); }
bool pending() { return dirty; }

void Panel::blit(int32_t x, int32_t y, int32_t w, int32_t h, const uint16_t* px) {
  if (!px) return;
  for (int32_t j = 0; j < h; j++) {
    for (int32_t i = 0; i < w; i++) {
      uint16_t be = px[j * w + i];
      canvas.drawPixel(x + i, y + j, ink565((uint16_t)((be >> 8) | (be << 8))));
    }
  }
}

}  // namespace EpdFrame
