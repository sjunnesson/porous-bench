#include "RgbPanel.h"
#include <initializer_list>
#include <esp_heap_caps.h>
#include <esp_lcd_panel_ops.h>
#include <esp_lcd_panel_rgb.h>
#include <esp32s3/rom/cache.h>
#include <soc/soc_memory_types.h>

namespace RgbPanel {

// The panel's init bus: 3-wire SPI, 9 bits a word (D/C, then 8 bits MSB
// first), mode 3. Only used at start; SCK and MOSI are the TF card's too.
static constexpr int PIN_CS = 39, PIN_SCK = 48, PIN_MOSI = 47;
// The RGB bus. Data lines in esp_lcd's order: D0-D4 blue, D5-D10 green,
// D11-D15 red, as ESPHome's and Arduino_GFX's configs wire them.
static constexpr int PIN_DE = 18, PIN_VSYNC = 17, PIN_HSYNC = 16, PIN_PCLK = 21;
static constexpr int PIN_DATA[16] = {4, 5, 6, 7, 15, 8, 20, 3, 46, 9, 10, 11, 12, 13, 14, 0};
static constexpr int PIN_BL = 38;
// Timing as Arduino_GFX runs this board with the same init sequence (ESPHome
// uses 8/10/20 and 8/10/10 with its own). Line: 480 + 10 + 8 + 50 clocks;
// frame: 480 + 10 + 8 + 20 lines; at 12 MHz, 42.3 frames a second.
static constexpr uint32_t PCLK_HZ = 12000000;
// The backlight's PWM: 20 kHz, above hearing. ESPHome runs it at 150 Hz,
// others at 100 Hz; at 150 Hz it whines faintly when dim, and at 20 kHz it
// fades as smoothly (2026-10-26, on the board).
static constexpr int BL_CHANNEL = 0, BL_HZ = 20000, BL_BITS = 10;

// A turned picture goes out STRIP frame rows at a time, read along image rows
// 16 pixels (32 bytes, one cache line) at a time.
static constexpr int STRIP = 16;

static esp_lcd_panel_handle_t s_panel = nullptr;
static volatile uint32_t s_scans = 0;
static float s_backlight = 1.0f;
static int s_rotation = 0;
static uint16_t* s_fb = nullptr;     // the frame being scanned, once found (findFrameBuffer)
static uint16_t* s_strip = nullptr;  // WIDTH x STRIP pixels for draw_bitmap, only if the frame wasn't found

static void spiWord(bool data, uint8_t v) {
  uint16_t word = (data ? 0x100 : 0) | v;
  for (int bit = 8; bit >= 0; bit--) {
    digitalWrite(PIN_SCK, LOW);
    digitalWrite(PIN_MOSI, (word >> bit) & 1);
    delayMicroseconds(1);
    digitalWrite(PIN_SCK, HIGH);  // the panel latches on the rising edge
    delayMicroseconds(1);
  }
}

static void command(uint8_t cmd, std::initializer_list<uint8_t> params = {}) {
  digitalWrite(PIN_CS, LOW);
  spiWord(false, cmd);
  for (uint8_t p : params) spiWord(true, p);
  digitalWrite(PIN_CS, HIGH);
}

// Arduino_GFX's st7701_type9_init_operations, "Init code for 480x480 square
// (86 Box) GUITION ESP32-4848S040 display", from the manufacturer. 0xCD 0x00
// keeps red and blue at full depth; no INVON; 0x3A 0x60: 18-bit interface,
// of which the board wires 16.
static void initSequence() {
  pinMode(PIN_CS, OUTPUT);
  pinMode(PIN_SCK, OUTPUT);
  pinMode(PIN_MOSI, OUTPUT);
  digitalWrite(PIN_CS, HIGH);
  digitalWrite(PIN_SCK, HIGH);

  // There's no reset pin: a software reset first, so a warm restart starts clean.
  command(0x01);
  delay(120);

  command(0xFF, {0x77, 0x01, 0x00, 0x00, 0x10});  // command bank 0
  command(0xC0, {0x3B, 0x00});
  command(0xC1, {0x0D, 0x02});
  command(0xC2, {0x31, 0x05});
  command(0xCD, {0x00});
  command(0xB0, {0x00, 0x11, 0x18, 0x0E, 0x11, 0x06, 0x07, 0x08,
                 0x07, 0x22, 0x04, 0x12, 0x0F, 0xAA, 0x31, 0x18});  // positive gamma
  command(0xB1, {0x00, 0x11, 0x19, 0x0E, 0x12, 0x07, 0x08, 0x08,
                 0x08, 0x22, 0x04, 0x11, 0x11, 0xA9, 0x32, 0x18});  // negative gamma

  command(0xFF, {0x77, 0x01, 0x00, 0x00, 0x11});  // command bank 1: power
  command(0xB0, {0x60});  // Vop 4.7375 V
  command(0xB1, {0x32});  // VCOM
  command(0xB2, {0x07});  // VGH 15 V
  command(0xB3, {0x80});
  command(0xB5, {0x49});  // VGL -10.17 V
  command(0xB7, {0x85});
  command(0xB8, {0x21});  // AVDD 6.6 V, AVCL -4.6 V
  command(0xC1, {0x78});
  command(0xC2, {0x78});
  command(0xE0, {0x00, 0x1B, 0x02});
  command(0xE1, {0x08, 0xA0, 0x00, 0x00, 0x07, 0xA0, 0x00, 0x00, 0x00, 0x44, 0x44});
  command(0xE2, {0x11, 0x11, 0x44, 0x44, 0xED, 0xA0, 0x00, 0x00, 0xEC, 0xA0, 0x00, 0x00});
  command(0xE3, {0x00, 0x00, 0x11, 0x11});
  command(0xE4, {0x44, 0x44});
  command(0xE5, {0x0A, 0xE9, 0xD8, 0xA0, 0x0C, 0xEB, 0xD8, 0xA0,
                 0x0E, 0xED, 0xD8, 0xA0, 0x10, 0xEF, 0xD8, 0xA0});
  command(0xE6, {0x00, 0x00, 0x11, 0x11});
  command(0xE7, {0x44, 0x44});
  command(0xE8, {0x09, 0xE8, 0xD8, 0xA0, 0x0B, 0xEA, 0xD8, 0xA0,
                 0x0D, 0xEC, 0xD8, 0xA0, 0x0F, 0xEE, 0xD8, 0xA0});
  command(0xEB, {0x02, 0x00, 0xE4, 0xE4, 0x88, 0x00, 0x40});
  command(0xEC, {0x3C, 0x00});
  command(0xED, {0xAB, 0x89, 0x76, 0x54, 0x02, 0xFF, 0xFF, 0xFF,
                 0xFF, 0xFF, 0xFF, 0x20, 0x45, 0x67, 0x98, 0xBA});

  command(0xFF, {0x77, 0x01, 0x00, 0x00, 0x13});  // command bank 3
  command(0xE5, {0xE4});
  command(0xFF, {0x77, 0x01, 0x00, 0x00, 0x00});  // back to the user commands

  command(0x3A, {0x60});
  command(0x11);  // sleep out
  delay(120);
  command(0x29);  // display on
}

static bool IRAM_ATTR onScan(esp_lcd_panel_handle_t, esp_lcd_rgb_panel_event_data_t*, void*) {
  s_scans++;
  return false;
}

// A turned picture is fastest turned straight into the frame (34 ms a frame,
// against 36 through a strip in internal RAM, 2026-10-26), but IDF 4.4 has no
// call that hands out the frame buffer (5.0 adds
// esp_lcd_rgb_panel_get_frame_buffer). The driver keeps the pointer in the
// panel's private state, so look for it there instead of copying 4.4's struct:
// a pointer into PSRAM, aligned as psram_trans_align asked, under which two
// corner pixels drawn through draw_bitmap read back, twice over. Not found,
// turned pushes go through draw_bitmap.
//
// The frame is written by the CPU, through the cache. GDMA (esp_async_memcpy)
// writes it twice as fast, but takes so much of PSRAM that the scan runs dry
// and the picture slips, again and again (2026-10-26, on the board).
static uint16_t* findFrameBuffer() {
  static const uint16_t marks[2][2] = {{0xA5C3, 0x3C5A}, {0x0FF0, 0xF00F}}, black = 0;
  const uint32_t* words = (const uint32_t*)s_panel;  // the base struct, then the driver's fields
  uint16_t* found = nullptr;
  for (int i = 0; i < 64 && !found; i++) {
    uint16_t* fb = (uint16_t*)words[i];
    if (((uint32_t)fb & 63) || !esp_ptr_external_ram(fb) || !esp_ptr_external_ram(fb + WIDTH * HEIGHT - 1)) continue;
    bool ok = true;
    for (const auto& m : marks) {
      esp_lcd_panel_draw_bitmap(s_panel, 0, 0, 1, 1, &m[0]);
      esp_lcd_panel_draw_bitmap(s_panel, WIDTH - 1, HEIGHT - 1, WIDTH, HEIGHT, &m[1]);
      ok = ok && fb[0] == m[0] && fb[WIDTH * HEIGHT - 1] == m[1];
    }
    if (ok) found = fb;
  }
  esp_lcd_panel_draw_bitmap(s_panel, 0, 0, 1, 1, &black);
  esp_lcd_panel_draw_bitmap(s_panel, WIDTH - 1, HEIGHT - 1, WIDTH, HEIGHT, &black);
  return found;
}

// Without the frame, a turned picture needs a strip to hand draw_bitmap.
static bool haveStrip() {
  if (s_rotation && !s_fb && !s_strip) {
    s_strip = (uint16_t*)heap_caps_malloc(WIDTH * STRIP * 2, MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);
  }
  return !s_rotation || s_fb || s_strip;
}

// Frame rows fy..fy+n-1, columns fx0..fx0+w-1, turned out of the image into
// `dst` (the frame at (fx0, fy), or a strip), `stride` pixels a frame row.
// Image (x, y) lands in the frame at 90: (H-1-y, x), 180: (W-1-x, H-1-y),
// 270: (y, W-1-x).
static void turn(const uint16_t* img, uint16_t* dst, int stride, int fx0, int w, int fy, int n) {
  if (s_rotation == 180) {
    for (int r = 0; r < n; r++) {
      const uint16_t* src = img + (HEIGHT - 1 - fy - r) * WIDTH + WIDTH - 1 - fx0;
      uint16_t* d = dst + r * stride;
      for (int c = 0; c < w; c++) *d++ = *src--;
    }
    return;
  }
  for (int c = 0; c < w; c++) {
    uint16_t* d = dst + c;
    if (s_rotation == 90) {
      const uint16_t* src = img + (HEIGHT - 1 - fx0 - c) * WIDTH + fy;
      for (int r = 0; r < n; r++, d += stride) *d = *src++;
    } else {
      const uint16_t* src = img + (fx0 + c) * WIDTH + WIDTH - 1 - fy;
      for (int r = 0; r < n; r++, d += stride) *d = *src--;
    }
  }
}

static bool startScan() {
  esp_lcd_rgb_panel_config_t cfg = {};
  cfg.clk_src = LCD_CLK_SRC_PLL160M;
  cfg.timings.pclk_hz = PCLK_HZ;
  cfg.timings.h_res = WIDTH;
  cfg.timings.v_res = HEIGHT;
  cfg.timings.hsync_pulse_width = 8;
  cfg.timings.hsync_back_porch = 50;
  cfg.timings.hsync_front_porch = 10;
  cfg.timings.vsync_pulse_width = 8;
  cfg.timings.vsync_back_porch = 20;
  cfg.timings.vsync_front_porch = 10;
  cfg.data_width = 16;
  cfg.psram_trans_align = 64;
  cfg.hsync_gpio_num = PIN_HSYNC;
  cfg.vsync_gpio_num = PIN_VSYNC;
  cfg.de_gpio_num = PIN_DE;
  cfg.pclk_gpio_num = PIN_PCLK;
  for (int i = 0; i < 16; i++) cfg.data_gpio_nums[i] = PIN_DATA[i];
  cfg.disp_gpio_num = -1;
  cfg.on_frame_trans_done = onScan;
  cfg.flags.fb_in_psram = 1;  // 480 x 480 x 2 = 450 KB

  if (esp_lcd_new_rgb_panel(&cfg, &s_panel) != ESP_OK) {
    s_panel = nullptr;
    return false;
  }
  esp_lcd_panel_reset(s_panel);
  esp_lcd_panel_init(s_panel);  // starts the scan, which never stops on its own
  s_fb = findFrameBuffer();
  if (!haveStrip()) s_rotation = 0;
  return true;
}

bool begin() {
  // Backlight off while the panel starts, so the power-on garbage never shows.
  ledcSetup(BL_CHANNEL, BL_HZ, BL_BITS);
  ledcAttachPin(PIN_BL, BL_CHANNEL);
  ledcWrite(BL_CHANNEL, 0);

  initSequence();
  if (!startScan()) return false;
  setBacklight(s_backlight);
  return true;
}

// `rows` is image row y0 of the whole image (the canvas).
void drawRows(const uint16_t* rows, int y0, int y1) {
  if (!s_panel) return;
  y0 = max(y0, 0);
  y1 = min(y1, HEIGHT - 1);
  if (y1 < y0) return;
  if (s_rotation == 0) {
    esp_lcd_panel_draw_bitmap(s_panel, 0, y0, WIDTH, y1 + 1, rows);  // as fast as memcpy: PSRAM is the limit
    return;
  }

  // Turned: a window of the frame, STRIP rows of it at a time.
  const uint16_t* img = rows - y0 * WIDTH;
  int fx0, w, fyA, fyB;
  if (s_rotation == 180) {
    // Image rows y1..y0 are frame rows H-1-y1..H-1-y0, each reversed.
    fx0 = 0;
    w = WIDTH;
    fyA = HEIGHT - 1 - y1;
    fyB = HEIGHT - y0;
  } else {
    // Image rows y0..y1 are a band of frame columns, all frame rows tall.
    fx0 = s_rotation == 90 ? HEIGHT - 1 - y1 : y0;
    w = y1 - y0 + 1;
    fyA = 0;
    fyB = HEIGHT;
  }
  for (int fy = fyA; fy < fyB; fy += STRIP) {
    int n = min(STRIP, fyB - fy);
    if (s_fb) {
      // The strip's frame rows (15 KB) stay in the cache while they fill, then go out together.
      turn(img, s_fb + fy * WIDTH + fx0, WIDTH, fx0, w, fy, n);
      Cache_WriteBack_Addr((uint32_t)(s_fb + fy * WIDTH), n * WIDTH * 2);
    } else {
      turn(img, s_strip, w, fx0, w, fy, n);
      esp_lcd_panel_draw_bitmap(s_panel, fx0, fy, fx0 + w, fy + n, s_strip);
    }
  }
}

bool setRotation(int degrees) {
  degrees = ((degrees % 360) + 360) % 360;
  s_rotation = degrees == 90 || degrees == 180 || degrees == 270 ? degrees : 0;
  if (haveStrip()) return true;
  s_rotation = 0;
  return false;
}

int rotation() { return s_rotation; }

void toImage(int& x, int& y) {
  int fx = x, fy = y;
  switch (rotation()) {
    case 90: x = fy; y = HEIGHT - 1 - fx; break;
    case 180: x = WIDTH - 1 - fx; y = HEIGHT - 1 - fy; break;
    case 270: x = WIDTH - 1 - fy; y = fx; break;
  }
}

bool restart() {
  if (s_panel) esp_lcd_panel_del(s_panel);
  s_panel = nullptr;
  s_fb = nullptr;
  return startScan();
}

bool writesDirect() { return s_fb; }

void setBacklight(float v) {
  s_backlight = constrain(v, 0.0f, 1.0f);
  ledcWrite(BL_CHANNEL, (uint32_t)(s_backlight * ((1 << BL_BITS) - 1) + 0.5f));
}

float backlight() { return s_backlight; }

uint32_t scans() { return s_scans; }

}  // namespace RgbPanel
