// Stage 1: bring-up of the Waveshare ESP32-C6-LCD-1.47, no Resident.
//
// Prints the chip and its memory over USB serial, then draws a
// test card into a full-frame RGB565 canvas (172x320, 110 KB) and pushes it
// in one transfer, timing the push: that's how stage 3's screen.flip() will
// work, so this proves the canvas fits and the bus is fast enough.
//
// What the card proves:
// - offsets: a 1 px white border on the visible edge, all four sides (the
//   panel's rounded corners clip it near the corners only);
// - orientation: "TOP" and the arrow should sit at the end away from the
//   USB-C port, and "L" / "R" on the left and right;
// - colours: red, green and blue bars, each labelled; a grey ramp.
// The RGB LED cycles red, green, blue, named on screen and on serial, which
// checks its colour order. The BOOT key (GPIO9) shows as up/down with a count.
#include <Arduino.h>
#include <SPI.h>
#include <Adafruit_GFX.h>
#include <Adafruit_ST7789.h>
#include <esp_heap_caps.h>
#include <esp_system.h>

// Wiring, fixed on the board (Waveshare's docs and demo).
static constexpr int PIN_MOSI = 6, PIN_SCLK = 7, PIN_MISO = 5;  // MISO only reaches the TF card
static constexpr int PIN_LCD_CS = 14, PIN_LCD_DC = 15, PIN_LCD_RST = 21, PIN_LCD_BL = 22;
static constexpr int PIN_SD_CS = 4;
static constexpr int PIN_RGB = 8;
static constexpr int PIN_BOOT = 9;

#ifndef LCD_SPI_HZ
#define LCD_SPI_HZ 80000000  // as Waveshare's demo runs it
#endif
// Adafruit's rotation 2 is the panel's native scan (MADCTL 0x00), the one
// Waveshare's demo uses; rotation 0 mirrors both axes (MX | MY).
#ifndef LCD_ROTATION
#define LCD_ROTATION 2
#endif

static constexpr int W = 172, H = 320;

static Adafruit_ST7789 tft(&SPI, PIN_LCD_CS, PIN_LCD_DC, PIN_LCD_RST);
static GFXcanvas16* canvas = nullptr;

static uint32_t bootPresses = 0;
static bool bootDown = false;
static uint32_t lastPushUs = 0;
static int ledPhase = 0;

static void printMemory(const char* when) {
  Serial.printf("[mem] %s: 8-bit heap %u free, largest block %u, internal %u\n", when,
                (unsigned)heap_caps_get_free_size(MALLOC_CAP_8BIT),
                (unsigned)heap_caps_get_largest_free_block(MALLOC_CAP_8BIT),
                (unsigned)heap_caps_get_free_size(MALLOC_CAP_INTERNAL));
}

static const char* resetReason() {
  switch (esp_reset_reason()) {
    case ESP_RST_POWERON: return "power-on";
    case ESP_RST_SW: return "software";
    case ESP_RST_PANIC: return "panic";
    case ESP_RST_INT_WDT: return "interrupt watchdog";
    case ESP_RST_TASK_WDT: return "task watchdog";
    case ESP_RST_WDT: return "watchdog";
    case ESP_RST_BROWNOUT: return "brownout";
    case ESP_RST_USB: return "USB";
    case ESP_RST_JTAG: return "JTAG";
    default: return "other";
  }
}

static void centred(const char* s, int y, uint8_t size, uint16_t colour) {
  int w = (int)strlen(s) * 6 * size;
  canvas->setTextSize(size);
  canvas->setTextColor(colour);
  canvas->setCursor((W - w) / 2, y);
  canvas->print(s);
}

static void drawCard() {
  static const char* ledNames[] = {"red", "green", "blue"};
  static const uint16_t ledColours[] = {ST77XX_RED, ST77XX_GREEN, ST77XX_BLUE};

  canvas->fillScreen(ST77XX_BLACK);
  canvas->setTextWrap(false);

  // The visible edge, 1 px.
  canvas->drawRect(0, 0, W, H, ST77XX_WHITE);

  // Which way is up.
  canvas->fillTriangle(W / 2, 8, W / 2 - 10, 22, W / 2 + 10, 22, ST77XX_YELLOW);
  centred("TOP", 26, 2, ST77XX_YELLOW);
  centred("C6-LCD-1.47 stage 1", 46, 1, ST77XX_WHITE);

  // Left and right edge markers, away from the rounded corners.
  canvas->setTextSize(1);
  canvas->setTextColor(ST77XX_CYAN);
  canvas->setCursor(3, 156);
  canvas->print("L");
  canvas->setCursor(W - 9, 156);
  canvas->print("R");

  // Colour bars, labelled with what they should be.
  struct Bar { const char* name; uint16_t colour; uint16_t text; };
  const Bar bars[] = {
    {"RED", ST77XX_RED, ST77XX_WHITE},
    {"GREEN", ST77XX_GREEN, ST77XX_BLACK},
    {"BLUE", ST77XX_BLUE, ST77XX_WHITE},
  };
  int y = 62;
  for (const Bar& b : bars) {
    canvas->fillRect(14, y, W - 28, 26, b.colour);
    canvas->setTextSize(2);
    canvas->setTextColor(b.text);
    canvas->setCursor(20, y + 6);
    canvas->print(b.name);
    y += 30;
  }

  // Grey ramp: 16 steps black to white.
  for (int i = 0; i < 16; i++) {
    uint8_t v = i * 17;
    canvas->fillRect(14 + i * 9, y + 2, 9, 14, tft.color565(v, v, v));
  }
  y += 24;

  // Live lines.
  char line[40];
  canvas->setTextSize(1);
  canvas->setTextColor(ST77XX_WHITE);
  snprintf(line, sizeof line, "%s %lu MHz", ESP.getChipModel(), (unsigned long)ESP.getCpuFreqMHz());
  canvas->setCursor(8, y); canvas->print(line); y += 12;
  snprintf(line, sizeof line, "heap %u KB, blk %u KB",
           (unsigned)(heap_caps_get_free_size(MALLOC_CAP_8BIT) / 1024),
           (unsigned)(heap_caps_get_largest_free_block(MALLOC_CAP_8BIT) / 1024));
  canvas->setCursor(8, y); canvas->print(line); y += 12;
  snprintf(line, sizeof line, "up %lus  push %lu.%lu ms", (unsigned long)(millis() / 1000),
           (unsigned long)(lastPushUs / 1000), (unsigned long)(lastPushUs % 1000 / 100));
  canvas->setCursor(8, y); canvas->print(line); y += 12;
  snprintf(line, sizeof line, "BOOT %s, presses %lu", bootDown ? "DOWN" : "up", (unsigned long)bootPresses);
  canvas->setTextColor(bootDown ? ST77XX_GREEN : ST77XX_WHITE);
  canvas->setCursor(8, y); canvas->print(line); y += 16;

  canvas->fillRect(8, y, 12, 12, ledColours[ledPhase]);
  snprintf(line, sizeof line, "LED should be %s", ledNames[ledPhase]);
  canvas->setTextColor(ST77XX_WHITE);
  canvas->setCursor(26, y + 2); canvas->print(line);

  // Bottom marker.
  centred("BOTTOM", H - 22, 1, ST77XX_YELLOW);
}

static void push() {
  uint32_t t0 = micros();
  tft.drawRGBBitmap(0, 0, canvas->getBuffer(), W, H);
  lastPushUs = micros() - t0;
}

// The board's LED takes its bytes in R, G, B order; rgbLedWrite sends a
// WS2812's G, R, B, so red and green go in swapped.
static void rgb(uint8_t r, uint8_t g, uint8_t b) { rgbLedWrite(PIN_RGB, g, r, b); }

static void setLed() {
  static const char* names[] = {"red", "green", "blue"};
  rgb(ledPhase == 0 ? 40 : 0, ledPhase == 1 ? 40 : 0, ledPhase == 2 ? 40 : 0);
  Serial.printf("[led] %s\n", names[ledPhase]);
}

void setup() {
  Serial.begin(115200);
  uint32_t t0 = millis();
  while (!Serial && millis() - t0 < 2000) delay(10);  // give a monitor time to attach
  Serial.println();
  Serial.println("=== Waveshare ESP32-C6-LCD-1.47: stage 1 bring-up ===");
  Serial.printf("Chip: %s rev %d, %d core(s) @ %lu MHz, reset: %s\n", ESP.getChipModel(),
                ESP.getChipRevision(), ESP.getChipCores(), (unsigned long)ESP.getCpuFreqMHz(),
                resetReason());
  Serial.printf("Flash: %lu KB (header) at %lu MHz; PSRAM: %lu KB\n",
                (unsigned long)(ESP.getFlashChipSize() / 1024),
                (unsigned long)(ESP.getFlashChipSpeed() / 1000000),
                (unsigned long)(ESP.getPsramSize() / 1024));
  Serial.printf("SDK %s, Arduino core %d.%d.%d\n", ESP.getSdkVersion(), ESP_ARDUINO_VERSION_MAJOR,
                ESP_ARDUINO_VERSION_MINOR, ESP_ARDUINO_VERSION_PATCH);
  printMemory("boot");

  pinMode(PIN_BOOT, INPUT_PULLUP);

  // The TF card shares the bus (unused here): keep it deselected.
  pinMode(PIN_SD_CS, OUTPUT);
  digitalWrite(PIN_SD_CS, HIGH);
  SPI.begin(PIN_SCLK, PIN_MISO, PIN_MOSI, -1);

  tft.init(W, H);  // 172x320: columns start at 34, INVON is in the init sequence
  tft.setSPISpeed(LCD_SPI_HZ);
  tft.setRotation(LCD_ROTATION);
  Serial.printf("[lcd] %dx%d, rotation %d, SPI %lu MHz\n", tft.width(), tft.height(), LCD_ROTATION,
                (unsigned long)(LCD_SPI_HZ / 1000000));

  // Backlight: plain PWM, dark until driven.
  ledcAttach(PIN_LCD_BL, 5000, 8);
  ledcWrite(PIN_LCD_BL, 255);

  canvas = new GFXcanvas16(W, H);
  if (!canvas || !canvas->getBuffer()) {
    Serial.println("[lcd] canvas allocation FAILED");
    tft.fillScreen(ST77XX_RED);
    while (true) delay(1000);
  }
  printMemory("after the 110 KB canvas");

  setLed();
  drawCard();
  push();
  Serial.printf("[lcd] full frame pushed in %lu us\n", (unsigned long)lastPushUs);
}

void loop() {
  static uint32_t lastDraw = 0, lastLed = 0, lastMem = 0;
  uint32_t now = millis();

  bool down = digitalRead(PIN_BOOT) == LOW;
  if (down != bootDown) {
    bootDown = down;
    if (down) bootPresses++;
    Serial.printf("[boot] %s (%lu)\n", down ? "down" : "up", (unsigned long)bootPresses);
    lastDraw = 0;  // show it now
  }

  if (now - lastLed >= 1500) {
    lastLed = now;
    ledPhase = (ledPhase + 1) % 3;
    setLed();
    lastDraw = 0;
  }

  if (now - lastDraw >= 1000) {
    lastDraw = now;
    drawCard();
    push();
  }

  if (now - lastMem >= 10000) {
    lastMem = now;
    Serial.printf("[lcd] last push %lu us\n", (unsigned long)lastPushUs);
    printMemory("running");
  }
  delay(5);
}
