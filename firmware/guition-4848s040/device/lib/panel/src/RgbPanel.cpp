#include "RgbPanel.h"
#include <initializer_list>
#include <esp_heap_caps.h>
#include <esp_lcd_panel_ops.h>
#include <esp_lcd_panel_rgb.h>
#include <esp32s3/rom/cache.h>
#include <esp_idf_version.h>
#ifdef BENCH_PROFILE
#include <esp_timer.h>
#include <sdkconfig.h>
#endif
// Stage 3 builds on Arduino core 3.x (ESP-IDF 5), stages 1-2 on core 2.x (IDF 4.4): both compile this.
#if ESP_IDF_VERSION_MAJOR >= 5
#include <esp_memory_utils.h>
#else
#include <soc/soc_memory_types.h>
#endif

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
#if ESP_IDF_VERSION_MAJOR >= 5
static constexpr uint32_t PCLK_HZ = 17030000;  // 60 frames a second, with bounce buffers (stage 3)
#else
static constexpr uint32_t PCLK_HZ = 12000000;
#endif
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
static int s_frames = 1;
static const uint16_t* volatile s_shown = nullptr;   // the frame show() last named: on the glass, or about to be
static const uint16_t* volatile s_scanned = nullptr; // the frame the refill interrupt is reading
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

#if defined(BENCH_PROFILE) && ESP_IDF_VERSION_MAJOR >= 5
// The driver's count of bounce buffers sent, whose parity picks the buffer it refills next. A frame is
// 48 of them. Profile builds only: the count lives in the driver's private state, found by the field
// after it (the 48 it expects a frame) and the one before (a position, whole buffers of 4800 pixels).
static volatile uint32_t* s_eofCount = nullptr;
static uint32_t s_eofLast = 0;
static ScanEvent s_scanEvents[32];
static volatile uint32_t s_scanEventN = 0;
static void findEofCount() {
  uint32_t* words = (uint32_t*)s_panel;
  for (int i = 2; i < 200; i++) {
    if (words[i] == 48 && words[i - 2] % 4800 == 0 && words[i - 2] < 480 * 480) {
      s_eofCount = &words[i - 1];
      Serial.printf("[scan] the driver's buffer count is at word %d\n", i - 1);
      return;
    }
  }
  Serial.println("[scan] the driver's buffer count wasn't found");
}
static inline void IRAM_ATTR noteScan() {
  if (!s_eofCount) return;
  uint32_t c = *s_eofCount;
#if CONFIG_LCD_RGB_RESTART_IN_VSYNC
  uint32_t got = c - s_eofLast;  // it just keeps counting
  s_eofLast = c;
#else
  uint32_t got = c;  // the driver sets it to 0 after this callback
#endif
  if (got != 48 && s_scans > 10) {
    uint32_t n = s_scanEventN;
    ScanEvent& e = s_scanEvents[n % 32];
    e.ms = (uint32_t)(esp_timer_get_time() / 1000), e.got = (uint16_t)got, e.odd = c & 1;
    s_scanEventN = n + 1;
  }
}
bool scanEvent(uint32_t i, ScanEvent& out) {
  if (i >= s_scanEventN || s_scanEventN - i > 32) return false;
  out = s_scanEvents[i % 32];
  return true;
}
uint32_t scanEvents() { return s_scanEventN; }
#endif

#if ESP_IDF_VERSION_MAJOR >= 5
static bool IRAM_ATTR onScan(esp_lcd_panel_handle_t, const esp_lcd_rgb_panel_event_data_t*, void*) {
#else
static bool IRAM_ATTR onScan(esp_lcd_panel_handle_t, esp_lcd_rgb_panel_event_data_t*, void*) {
#endif
#if defined(BENCH_PROFILE) && ESP_IDF_VERSION_MAJOR >= 5
  noteScan();
#endif
  s_scans = s_scans + 1;  // not ++: C++20 (core 3.x) deprecates it on a volatile
  return false;
}

#if ESP_IDF_VERSION_MAJOR >= 5
// The refill interrupt has copied the last rows of a frame out, and takes the next frame's from
// whichever show() named last: the one it was reading is free to draw into.
static volatile uint32_t s_latches = 0;
static volatile bool s_showing = false;  // the driver also calls this from show() itself, where no frame has ended
static bool IRAM_ATTR onFrameRead(esp_lcd_panel_handle_t, const esp_lcd_rgb_panel_event_data_t*, void*) {
  if (s_showing) return false;
  s_scanned = s_shown;
  s_latches = s_latches + 1;
  return false;
}
#endif

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
#if ESP_IDF_VERSION_MAJOR >= 5
  // IDF 5 hands it out.
  void* fb = nullptr;
  return esp_lcd_rgb_panel_get_frame_buffer(s_panel, 1, &fb) == ESP_OK ? (uint16_t*)fb : nullptr;
#else
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
#endif
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
#if ESP_IDF_VERSION_MAJOR >= 5
  cfg.dma_burst_size = 64;  // psram_trans_align's successor: 64-byte aligned frame, 64-byte bursts
  // The scan reads two 10-row buffers in internal RAM, which an interrupt refills from the frame in
  // PSRAM. Straight from PSRAM, as on IDF 4.4, the scan ran short whenever the app and the flips
  // kept PSRAM busy, and IDF 5's driver (a looping DMA, restarted at each vertical sync) showed
  // every such frame shifted: the picture jumped about (2026-11-02, on the board). 19 KB of
  // internal RAM; 480 x 480 is 48 of them.
  cfg.bounce_buffer_size_px = WIDTH * 10;
  cfg.num_fbs = s_frames;
#else
  cfg.psram_trans_align = 64;
#endif
  // gpio_num_t: IDF 6 types these fields (4.4 and 5 take an int either way).
  cfg.hsync_gpio_num = (gpio_num_t)PIN_HSYNC;
  cfg.vsync_gpio_num = (gpio_num_t)PIN_VSYNC;
  cfg.de_gpio_num = (gpio_num_t)PIN_DE;
  cfg.pclk_gpio_num = (gpio_num_t)PIN_PCLK;
  for (int i = 0; i < 16; i++) cfg.data_gpio_nums[i] = (gpio_num_t)PIN_DATA[i];
  cfg.disp_gpio_num = GPIO_NUM_NC;
#if ESP_IDF_VERSION_MAJOR < 5
  cfg.on_frame_trans_done = onScan;
#endif
  cfg.flags.fb_in_psram = 1;  // 480 x 480 x 2 = 450 KB

  if (esp_lcd_new_rgb_panel(&cfg, &s_panel) != ESP_OK) {
    s_panel = nullptr;
    return false;
  }
#if ESP_IDF_VERSION_MAJOR >= 5
  // A scan ends at each vertical sync (IDF 5 takes the callback here, not in the config).
  esp_lcd_rgb_panel_event_callbacks_t cbs = {};
  cbs.on_vsync = onScan;
#if ESP_IDF_VERSION_MAJOR >= 6
  cbs.on_frame_buf_complete = onFrameRead;
#else
  cbs.on_bounce_frame_finish = onFrameRead;
#endif
  esp_lcd_rgb_panel_register_event_callbacks(s_panel, &cbs, nullptr);
#endif
  esp_lcd_panel_reset(s_panel);
  esp_lcd_panel_init(s_panel);  // starts the scan, which never stops on its own
  s_fb = findFrameBuffer();
  s_shown = s_scanned = s_fb;
#if defined(BENCH_PROFILE) && ESP_IDF_VERSION_MAJOR >= 5
  findEofCount();
#endif
  if (!haveStrip()) s_rotation = 0;
  return true;
}

static void setBacklightRaw(uint32_t duty) {
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcWrite(PIN_BL, duty);
#else
  ledcWrite(BL_CHANNEL, duty);
#endif
}

bool begin(int frames) {
  s_frames = constrain(frames, 1, 3);
  // Backlight off while the panel starts, so the power-on garbage never shows.
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcAttach(PIN_BL, BL_HZ, BL_BITS);  // core 3.x: the pin is the channel's handle
#else
  ledcSetup(BL_CHANNEL, BL_HZ, BL_BITS);
  ledcAttachPin(PIN_BL, BL_CHANNEL);
#endif
  setBacklightRaw(0);

  initSequence();
  if (!startScan()) return false;
  setBacklight(s_backlight);
  return true;
}

// Inside beginBatch()..endBatch() the frame rows written are noted and written
// back from the cache once, at the end, instead of after each rectangle.
//
// With bounce buffers (IDF 5 and later here) nothing is written back at all: the interrupt that
// refills them reads the frame with the CPU, through the same cache the CPU wrote it through, as
// esp_lcd's own draw_bitmap notes. Only a DMA reading PSRAM itself (IDF 4.4) needs PSRAM up to date.
// Writing back anyway walked every cache line of the rows between the first and last tile drawn,
// on each push.
static int s_batch = 0;
static int s_backLo = HEIGHT, s_backHi = -1;
#if ESP_IDF_VERSION_MAJOR >= 5
static constexpr bool WRITE_BACK = false;
#else
static constexpr bool WRITE_BACK = true;
#endif

static void written(int fy0, int fy1) { // frame rows fy0..fy1 changed in the cache
  if (!WRITE_BACK) return;
  if (s_batch) {
    s_backLo = min(s_backLo, fy0);
    s_backHi = max(s_backHi, fy1);
    return;
  }
  Cache_WriteBack_Addr((uint32_t)(s_fb + fy0 * WIDTH), (fy1 - fy0 + 1) * WIDTH * 2);
}

void beginBatch() { s_batch++; }

void endBatch() {
  if (s_batch == 0 || --s_batch > 0) return;
  if (WRITE_BACK && s_fb && s_backHi >= 0) {
    Cache_WriteBack_Addr((uint32_t)(s_fb + s_backLo * WIDTH), (s_backHi - s_backLo + 1) * WIDTH * 2);
  }
  s_backLo = HEIGHT;
  s_backHi = -1;
}

void drawRect(const uint16_t* img, int x0, int y0, int x1, int y1) {
  if (!s_panel) return;
  x0 = max(x0, 0), y0 = max(y0, 0), x1 = min(x1, WIDTH - 1), y1 = min(y1, HEIGHT - 1);
  if (x1 < x0 || y1 < y0) return;
  int w = x1 - x0 + 1;
  if (s_rotation == 0) {
    if (s_fb) {
      for (int y = y0; y <= y1; y++) memcpy(s_fb + y * WIDTH + x0, img + y * WIDTH + x0, w * 2);
      written(y0, y1);
    } else if (w == WIDTH) {
      esp_lcd_panel_draw_bitmap(s_panel, 0, y0, WIDTH, y1 + 1, img + y0 * WIDTH);
    } else {
      for (int y = y0; y <= y1; y++) esp_lcd_panel_draw_bitmap(s_panel, x0, y, x1 + 1, y + 1, img + y * WIDTH + x0);
    }
    return;
  }

  // Turned: the rectangle's window in the frame, STRIP rows of it at a time.
  int fx0, fw, fyA, fyB;
  if (s_rotation == 180) { // image (x, y) -> frame (W-1-x, H-1-y)
    fx0 = WIDTH - 1 - x1, fw = w, fyA = HEIGHT - 1 - y1, fyB = HEIGHT - y0;
  } else if (s_rotation == 90) { // (x, y) -> (H-1-y, x)
    fx0 = HEIGHT - 1 - y1, fw = y1 - y0 + 1, fyA = x0, fyB = x1 + 1;
  } else { // 270: (x, y) -> (y, W-1-x)
    fx0 = y0, fw = y1 - y0 + 1, fyA = WIDTH - 1 - x1, fyB = WIDTH - x0;
  }
  for (int fy = fyA; fy < fyB; fy += STRIP) {
    int n = min(STRIP, fyB - fy);
    if (s_fb) {
      turn(img, s_fb + fy * WIDTH + fx0, WIDTH, fx0, fw, fy, n);
    } else {
      turn(img, s_strip, fw, fx0, fw, fy, n);
      esp_lcd_panel_draw_bitmap(s_panel, fx0, fy, fx0 + fw, fy + n, s_strip);
    }
  }
  if (s_fb) written(fyA, fyB - 1);
}

// `rows` is image row y0 of the whole image (the canvas).
void drawRows(const uint16_t* rows, int y0, int y1) { drawRect(rows - y0 * WIDTH, 0, y0, WIDTH - 1, y1); }

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

int frames(uint16_t** out, int max) {
#if ESP_IDF_VERSION_MAJOR >= 5
  void* fb[3] = {};
  int n = min(max, s_frames);
  if (!s_panel || n < 1) return 0;
  esp_err_t err = n == 1 ? esp_lcd_rgb_panel_get_frame_buffer(s_panel, 1, &fb[0])
                : n == 2 ? esp_lcd_rgb_panel_get_frame_buffer(s_panel, 2, &fb[0], &fb[1])
                         : esp_lcd_rgb_panel_get_frame_buffer(s_panel, 3, &fb[0], &fb[1], &fb[2]);
  if (err != ESP_OK) return 0;
  for (int i = 0; i < n; i++) out[i] = (uint16_t*)fb[i];
  return n;
#else
  return 0;
#endif
}

// A pointer into one of its own frames tells the driver to scan that one from the next frame on:
// nothing is copied, and with bounce buffers nothing needs writing back from the cache. s_shown
// follows the call: an interrupt between the two leaves the frame it was reading marked in use for
// one scan more, and never a frame free that's on the glass.
void show(const uint16_t* frame) {
  if (!s_panel) return;
  s_showing = true;
  esp_lcd_panel_draw_bitmap(s_panel, 0, 0, WIDTH, HEIGHT, frame);
  s_showing = false;
  s_shown = frame;
}

uint32_t latches() {
#if ESP_IDF_VERSION_MAJOR >= 5
  return s_latches;
#else
  return s_scans;
#endif
}

#ifdef BENCH_PROFILE
void setPixelClock(uint32_t hz) {
#if ESP_IDF_VERSION_MAJOR >= 5
  if (s_panel) esp_lcd_rgb_panel_set_pclk(s_panel, hz);
#endif
}
#endif

bool inUse(const uint16_t* frame) { return frame == s_shown || frame == s_scanned; }

void setBacklight(float v) {
  s_backlight = constrain(v, 0.0f, 1.0f);
  setBacklightRaw((uint32_t)(s_backlight * ((1 << BL_BITS) - 1) + 0.5f));
}

float backlight() { return s_backlight; }

uint32_t scans() { return s_scans; }

}  // namespace RgbPanel
