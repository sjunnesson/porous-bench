// Stage 1 bring-up: Waveshare ESP32 e-Paper Driver Board + 2.13" e-Paper (V2 panel, IL3897).
//
// Prints chip info over serial, then draws a test card that proves
// orientation (TOP / corner labels), offsets (a 1 px border on the visible
// edge, ticks on the left edge every 10 px) and tones (black, 50 % and 25 %
// dither, white: the panel is B/W, so these stand in for colour bars).
// Every 10 s the footer updates with a partial refresh; every 10th refresh
// is a full one to clear ghosting.
#include <Arduino.h>
#include <Adafruit_GFX.h>
#include "Epd213.h"

// Waveshare ESP32 e-Paper Driver Board, fixed wiring.
static Epd213 epd({/*din*/ 14, /*clk*/ 13, /*cs*/ 15, /*dc*/ 27, /*rst*/ 26, /*busy*/ 25});

// 1 bit per pixel, 16-byte rows: the panel's own layout.
static GFXcanvas1 canvas(Epd213::WIDTH, Epd213::HEIGHT);
static constexpr uint16_t BLACK = 0, WHITE = 1;

static uint32_t refreshes = 0;

static void printChipInfo() {
  Serial.println();
  Serial.println("=== Waveshare 2.13\" e-Paper (HINK-E0213A22, V2): bring-up ===");
  Serial.printf("Chip:   %s rev %d, %d core(s) @ %lu MHz\n", ESP.getChipModel(),
                ESP.getChipRevision(), ESP.getChipCores(),
                (unsigned long)ESP.getCpuFreqMHz());
  Serial.printf("Flash:  %lu KB\n", (unsigned long)(ESP.getFlashChipSize() / 1024));
  Serial.printf("PSRAM:  %lu KB\n", (unsigned long)(ESP.getPsramSize() / 1024));
  Serial.printf("Heap:   %lu KB free\n", (unsigned long)(ESP.getFreeHeap() / 1024));
  Serial.printf("MAC:    %012llX\n", ESP.getEfuseMac());
  Serial.printf("Panel:  %dx%d, %d-byte rows, %d-byte frame\n", Epd213::WIDTH,
                Epd213::HEIGHT, Epd213::ROW_BYTES, Epd213::FRAME_BYTES);
}

static void ditherBar(int x, int y, int w, int h, int every) {
  canvas.fillRect(x, y, w, h, WHITE);
  for (int j = y; j < y + h; j++)
    for (int i = x; i < x + w; i++)
      if (every == 2 ? ((i + j) & 1) == 0 : ((i & 1) == 0 && (j & 1) == 0))
        canvas.drawPixel(i, j, BLACK);
  canvas.drawRect(x, y, w, h, BLACK);
}

static void centered(const char* s, int y, uint8_t size) {
  int w = strlen(s) * 6 * size - size;
  canvas.setTextSize(size);
  canvas.setCursor((Epd213::WIDTH - w) / 2, y);
  canvas.print(s);
}

static void drawFooter() {
  const int y = 214;
  canvas.fillRect(4, y, Epd213::WIDTH - 8, 22, WHITE);
  canvas.setTextSize(1);
  canvas.setTextColor(BLACK);
  canvas.setCursor(8, y + 2);
  canvas.printf("up %lus  #%lu", (unsigned long)(millis() / 1000), (unsigned long)refreshes);
  canvas.setCursor(8, y + 12);
  canvas.printf("last %lu ms", (unsigned long)epd.lastRefreshMs());
}

static void drawTestCard() {
  const int W = Epd213::WIDTH, H = Epd213::HEIGHT;
  canvas.fillScreen(WHITE);
  canvas.setTextWrap(false);
  canvas.setTextColor(BLACK);

  // 1 px border exactly on the visible edge: all four sides must show.
  canvas.drawRect(0, 0, W, H, BLACK);

  // Left-edge ruler: a tick every 10 px, longer every 50.
  for (int y = 10; y < H; y += 10) canvas.drawFastHLine(1, y, y % 50 ? 3 : 6, BLACK);

  // Corners.
  canvas.setTextSize(1);
  canvas.setCursor(8, 3);           canvas.print("TL");
  canvas.setCursor(W - 3 - 11, 3);  canvas.print("TR");
  canvas.setCursor(8, H - 10);      canvas.print("BL");
  canvas.setCursor(W - 3 - 11, H - 10); canvas.print("BR");

  // Orientation: an arrow pointing at the top edge.
  canvas.fillTriangle(W / 2, 4, W / 2 - 6, 12, W / 2 + 6, 12, BLACK);
  centered("TOP", 16, 2);

  // Tone bars.
  const int bx = 10, bw = W - 20, bh = 14;
  canvas.fillRect(bx, 40, bw, bh, BLACK);
  ditherBar(bx, 58, bw, bh, 2);     // 50 %
  ditherBar(bx, 76, bw, bh, 4);     // 25 %
  canvas.drawRect(bx, 94, bw, bh, BLACK);  // white
  canvas.setTextSize(1);
  canvas.setTextColor(WHITE);
  canvas.setCursor(bx + 3, 44); canvas.print("BLACK");
  canvas.setTextColor(BLACK);
  canvas.setCursor(bx + 3, 98); canvas.print("WHITE");

  // A 1 px checkerboard square: proves single pixels land where drawn.
  for (int j = 0; j < 16; j++)
    for (int i = 0; i < 16; i++)
      if ((i + j) & 1) canvas.drawPixel(W - 26 + i, 116 + j, BLACK);
  canvas.drawRect(W - 27, 115, 18, 18, BLACK);

  // Chip info.
  canvas.setCursor(8, 116); canvas.print(ESP.getChipModel());
  canvas.setCursor(8, 126); canvas.printf("%lu MHz x%d", (unsigned long)ESP.getCpuFreqMHz(), ESP.getChipCores());
  canvas.setCursor(8, 136); canvas.printf("flash %lu MB", (unsigned long)(ESP.getFlashChipSize() >> 20));
  canvas.setCursor(8, 146); canvas.printf("psram %lu KB", (unsigned long)(ESP.getPsramSize() >> 10));
  canvas.setCursor(8, 162); canvas.print("122x250 IL3897 (V2)");
  canvas.setCursor(8, 172); canvas.print("x0..121  y0..249");

  // Right-edge marker: pixel column 121 is the last visible one.
  canvas.drawFastVLine(W - 3, 186, 20, BLACK);
  canvas.setCursor(W - 3 - 6 * 7, 192); canvas.print("x=119>");

  drawFooter();
}

void setup() {
  Serial.begin(115200);
  delay(500);
  printChipInfo();

  epd.begin();
  epd.setFullEvery(10);
  drawTestCard();
  epd.showFull(canvas.getBuffer());
  refreshes++;
  Serial.printf("[epd] full refresh: %lu ms\n", (unsigned long)epd.lastRefreshMs());
  drawFooter();  // repaint with the measured refresh time
  epd.showPartial(canvas.getBuffer());
  refreshes++;
  Serial.printf("[epd] partial refresh: %lu ms\n", (unsigned long)epd.lastRefreshMs());
  Serial.println("Ready: footer updates every 10 s (full refresh every 10th).");
}

void loop() {
  static uint32_t last = 0;
  if (millis() - last < 10000) return;
  last = millis();
  drawFooter();
  epd.show(canvas.getBuffer());
  refreshes++;
  Serial.printf("[epd] refresh #%lu: %lu ms, heap %lu\n", (unsigned long)refreshes,
                (unsigned long)epd.lastRefreshMs(), (unsigned long)ESP.getFreeHeap());
}
