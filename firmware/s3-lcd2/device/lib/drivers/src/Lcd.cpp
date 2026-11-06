#include "Lcd.h"
#include <soc/spi_struct.h>
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

// 64 bytes of pixels as the SPI peripheral's 16 data words: the wire takes each word's low byte first,
// and the panel each pixel's high byte first. `n` bytes, even; nothing is read past them.
static inline void spiWords(uint32_t* words, const uint16_t* px, uint32_t n, bool bigEndian) {
  uint32_t i = 0;
  if (bigEndian) {
    for (; i + 4 <= n; i += 4, px += 2) words[i / 4] = (uint32_t)px[0] | (uint32_t)px[1] << 16;
    if (i < n) words[i / 4] = px[0];
  } else {
    for (; i + 4 <= n; i += 4, px += 2) {
      words[i / 4] = (uint32_t)__builtin_bswap16(px[0]) | (uint32_t)__builtin_bswap16(px[1]) << 16;
    }
    if (i < n) words[i / 4] = __builtin_bswap16(px[0]);
  }
}

// Pixels out to the panel, inside startWrite()..endWrite() and after setAddrWindow(): what
// SPIClass::writePixels (pixels in the chip's own order) and writeBytes (big-endian already, as LVGL's
// flushes come) do, the same registers in the same order, with one difference. The peripheral sends 64
// bytes at a time, and the core makes each 64 ready only once the last has gone: reading the canvas out
// of PSRAM and swapping bytes while the bus sits idle, which had it idle a third of the time (a whole
// frame took 24 ms where 80 MHz needs 15.4, and a profile of a full-screen app had 68% of the core in
// that loop). Here the next 64 are made ready while the last are going out. `mirror`: the pixels are
// also written there in the chip's order, `stride` pixels from one row of `w` to the next (LVGL's
// flush into the canvas, done in the same wait).
static void sendPixels(const uint16_t* px, uint32_t count, bool bigEndian, uint16_t* mirror = nullptr, int w = 0,
                       int stride = 0) {
  spi_dev_t* dev = &GPSPI2;  // Arduino's SPI on the S3 (FSPI)
  uint32_t words[16], col = 0;
  for (uint32_t bytes = count * 2; bytes;) {
    uint32_t n = bytes > 64 ? 64 : bytes;
    spiWords(words, px, n, bigEndian);
    if (mirror) {
      for (uint32_t k = 0; k < n / 2; k++) {
        mirror[col] = bigEndian ? __builtin_bswap16(px[k]) : px[k];
        if (++col == (uint32_t)w) col = 0, mirror += stride;
      }
    }
    while (dev->cmd.usr) {}  // the 64 before are out
    dev->ms_dlen.ms_data_bitlen = n * 8 - 1;
    for (uint32_t i = 0; i < (n + 3) / 4; i++) dev->data_buf[i] = words[i];
    dev->cmd.update = 1;
    while (dev->cmd.update) {}
    dev->cmd.usr = 1;
    px += n / 2;
    bytes -= n;
  }
  while (dev->cmd.usr) {}  // and the last, before the caller lets go of the panel
}

#ifdef BENCH_PROFILE
// The words sendPixels() makes against the Arduino core's own arithmetic (MSB_PIX_SET and MSB_16_SET in
// esp32-hal-spi.c, and bytes as they are for writeBytes), for every length a chunk can have.
uint32_t spiSelfTest() {
  uint32_t differ = 0, rnd = 2463534242u;
  static uint16_t px[34];
  for (int round = 0; round < 200; round++) {
    for (auto& p : px) rnd ^= rnd << 13, rnd ^= rnd >> 17, rnd ^= rnd << 5, p = (uint16_t)rnd;
    for (uint32_t n = 2; n <= 64; n += 2) {
      for (int be = 0; be < 2; be++) {
        uint32_t got[16] = {}, want[16] = {};
        spiWords(got, px, n, be);
        const uint8_t* d = (const uint8_t*)px;
        for (uint32_t i = 0; i < n; i++) {  // byte i on the wire: as it is, or its pixel's other byte
          uint8_t b = be ? d[i] : d[i ^ 1];
          want[i / 4] |= (uint32_t)b << (8 * (i % 4));
        }
        for (uint32_t i = 0; i < (n + 3) / 4; i++) differ += got[i] != want[i];
      }
    }
  }
  return differ;
}
#endif

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
  ledcAttach(PIN_BL, 10000, 10);  // core 3.x: the pin is the channel's handle
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
// drawn (transparent, past the end) above 0xFFFF. A region is often drawn from one palette several
// times over (a backdrop, then each sprite), so the last one is kept and only made again when the
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

#ifdef BENCH_PROFILE
bool hashFlips = false;
static void printHash() {
  uint32_t h = 2166136261u;
  const uint16_t* p = canvas->getBuffer();
  for (int i = 0; i < WIDTH * HEIGHT; i++) h = (h ^ p[i]) * 16777619u;
  static int n = 0;
  Serial.printf("[hash] %d %08x\n", ++n, (unsigned)h);
}
#endif

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
      if (w == WIDTH) sendPixels(buf + y0 * WIDTH, w * h, false);
      else for (int y = y0; y < y0 + h; y++) sendPixels(buf + y * WIDTH + x0, w, false);
      pixels += w * h;
    }
  }
  if (!pixels) return;
  tft.endWrite();
#ifdef BENCH_PROFILE
  if (hashFlips) printHash();
#endif
  _lastPushUs = micros() - t0;
  _frames++;
  _pixels += pixels;
  _pushUs += _lastPushUs;
}

void setBrightness(float v) {
  _brightness = constrain(v, 0.0f, 1.0f);
  ledcWrite(PIN_BL, (uint32_t)(_brightness * 1023.0f + 0.5f));
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
  uint32_t t0 = micros();
  tft.startWrite();
  if (x0 == x && x1 == x + w && r0 == y && r1 == y + h) {
    // Out as it is (big-endian), and into the canvas in the chip's order while each 64 bytes go.
    tft.setAddrWindow(x, y, w, h);
    sendPixels(px, (uint32_t)w * h, true, buf + y * WIDTH + x, w, WIDTH);
  } else {  // clipped (LVGL doesn't, but just in case): into the canvas, then from it
    for (int32_t cy = r0; cy < r1; cy++) {
      const uint16_t* src = px + (cy - y) * w + (x0 - x);
      uint16_t* dst = buf + cy * WIDTH + x0;
      for (int32_t n = x1 - x0; n > 0; n--) *dst++ = __builtin_bswap16(*src++);
    }
    tft.setAddrWindow(x0, r0, x1 - x0, r1 - r0);
    for (int32_t cy = r0; cy < r1; cy++) sendPixels(buf + cy * WIDTH + x0, x1 - x0, false);
  }
  tft.endWrite();
  _pushUs += micros() - t0;
  _pixels += (x1 - x0) * (r1 - r0);
}

void Panel::frameDone() {
  _frames++;
#ifdef BENCH_PROFILE
  if (hashFlips) printHash();
#endif
}

}  // namespace Lcd
