// Stage 3: Resident with drivers on the Guition ESP32-S3-4848S040. Lua
// modules: screen (M5Stick verbs), lgfx (LovyanGFX-style, same frame), lvgl
// (LVGL 9 via luavgl, flushed into the same frame), button (no keys on this
// board: Bench's taps arrive through it while Bench mirrors an app),
// touchscreen (GT911: read() and touch_* events; also the system button),
// screens ("main": 480x480, 16-bit, dark, brightness). Lua, the three frames
// and the code itself live in PSRAM; LVGL's objects in pools of internal RAM.
// Parts on the bench come from Bench while it mirrors an app here, so there
// are no drivers for them.
#include <Arduino.h>
#include <esp_heap_caps.h>
#include <Resident.h>
#include <ResidentLgfxModule.h>
#include <ResidentLvglModule.h>
#include <lvgl.h>
#include <src/core/lv_refr_private.h>
#include <src/misc/lv_timer_private.h>
#include "Lcd.h"
#include "ScreenDriver.h"
#include "CanvasLgfxTarget.h"
#include "ButtonsDriver.h"
#include "TouchDriver.h"
#include "AppStore.h"
#include "RootCerts.h"
#include "TlsInPsram.h"
#include "BootGuard.h"
#include "Profiler.h"

// Another relay that speaks the same wire (a self-hosted Worker) goes in at
// build time: PLATFORMIO_BUILD_FLAGS='-DRELAY_HOST=\"my-relay.example.dev\"'.
#ifdef RELAY_HOST
static constexpr const char* RESIDENT_HOST = RELAY_HOST;
#else
static constexpr const char* RESIDENT_HOST = "resident.inanimate.tech";
#endif
static constexpr uint16_t RESIDENT_PORT = 443;

ScreenDriver screenDriver;
ButtonsDriver buttonDriver{-1};  // no keys: BOOT is inside the case, and its GPIO0 drives the panel
TouchDriver touchDriver;
CanvasLgfxTarget lgfxMain;
Resident::LgfxModule lgfxModule;
Resident::LvglModule lvglModule;
AppStore appStore;  // the last app for the next boot, on LittleFS (NVS is too small)

// Arduino's loop task has 8 KB, and LVGL draws on it: an app with many transformed objects overflowed
// it and rebooted the board (Stack canary watchpoint triggered). [perf] reports what's left.
SET_LOOP_TASK_STACK_SIZE(16 * 1024);

// At boot only. A heap's largest free block is found by walking every block with interrupts off, and
// an app's Lua makes a great many in PSRAM: 4.4 to 9.5 ms, and the panel's refill interrupt can't wait
// 0.5 ms. Done every 30 s, that made the picture jump every 30 s (2026-11-06, with an app of 2-3 MB).
static void printMemory(const char* when) {
  Serial.printf("[mem] %s: internal free %u (largest %u, lowest %u), PSRAM free %u (largest %u)\n", when,
                (unsigned)heap_caps_get_free_size(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT),
                (unsigned)heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT),
                (unsigned)heap_caps_get_minimum_free_size(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT),
                (unsigned)heap_caps_get_free_size(MALLOC_CAP_SPIRAM),
                (unsigned)heap_caps_get_largest_free_block(MALLOC_CAP_SPIRAM));
}

// While an app runs: only the running totals the heap keeps, which walk nothing.
static void printMemoryNow() {
  Serial.printf("[mem] now: internal free %u (lowest %u), PSRAM free %u\n",
                (unsigned)heap_caps_get_free_size(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT),
                (unsigned)heap_caps_get_minimum_free_size(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT),
                (unsigned)heap_caps_get_free_size(MALLOC_CAP_SPIRAM));
}

static Resident::SandboxConfig makeConfig() {
  Resident::SandboxConfig cfg;
  cfg.deviceType = "guition-4848";
  cfg.firmwareVersion = "guition-4848-0.1";
  cfg.tickIntervalMs = 33;  // on_tick at ~30 FPS, not Resident's 10: the panel keeps up (README)
  cfg.tickDue = Lcd::tickDue;  // on every second scan of the panel, so each frame stays on the glass as long
  // Plenum's iso surfaces (~430 KB) decode their backdrop and sprites before init: over Resident's
  // 1 s guard on the S3, so the app was aborted before it started. Report what runs past 100 ms.
  cfg.executionDeadlineMs = 8000;
  cfg.executionSoftDeadlineMs = 100;
  lgfxModule.addDisplay("main", &lgfxMain);
  // LVGL's display is only created when an app first calls lvgl.bind("main");
  // it flushes into the same frame as screen/lgfx. Its draw buffer is ours, in
  // internal RAM: LVGL's own (a tenth of the screen, from lv_malloc) landed
  // in PSRAM, where rendering is slower. 32 rows: a whole number of the frame's
  // 16-pixel tiles, so a strip of a full repaint never leaves a tile half
  // drawn to be brought over first (40 rows did, a third of them). 48 rows were
  // 6-8% faster for screens of arcs and cost 15 KB more internal RAM.
  Resident::LvglModule::DisplayOptions lv;
  lv.bufferRows = 32;
  lv.bufferBytes = 480 * 32 * 2;
  lv.buffer = heap_caps_malloc(lv.bufferBytes, MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);
  lvglModule.addDisplay("main", lv);
  cfg.extensions = {&screenDriver, &buttonDriver, &touchDriver, &lgfxModule, &lvglModule};
  cfg.systemDisplay = &screenDriver;
  cfg.systemButton = &touchDriver;  // a touch = load the saved app now, a long one = forget it
  cfg.persistentStore = &appStore;

  // Courier::Config has a constructor with default args, so designated
  // initializers don't compile under strict ESP-IDF builds.
  Courier::Config courier;
  courier.host = RESIDENT_HOST;
  courier.port = RESIDENT_PORT;
  cfg.network = courier;
  return cfg;
}

Resident::Sandbox sandbox{makeConfig()};

void setup() {
  TlsInPsram::begin();
#ifdef BENCH_PROFILE
  Serial.setRxBufferSize(32768);  // an app arrives over serial while a frame may be drawing
#endif
  Serial.begin(115200);
  BootGuard::begin();
  Serial.println();
  Serial.println("=== Guition ESP32-S3-4848S040: Resident + drivers ===");
  Serial.printf("Chip: %s rev %d @ %lu MHz, flash %lu KB, PSRAM %lu KB\n", ESP.getChipModel(),
                ESP.getChipRevision(), (unsigned long)ESP.getCpuFreqMHz(),
                (unsigned long)(ESP.getFlashChipSize() / 1024),
                (unsigned long)(ESP.getPsramSize() / 1024));
  printMemory("boot");

  // Panel and the full-frame canvas first, so Resident's first status has
  // somewhere to go.
#ifdef BENCH_PROFILE
  uint32_t spinBefore = Profiler::spin();
#endif
  if (!Lcd::begin()) {
    Serial.println("[lcd] panel scan or canvas allocation FAILED");
    while (true) delay(1000);
  }
  printMemory("after the canvas");
#ifdef BENCH_PROFILE
  Serial.printf("[prof] spin %u us before the scan, %u us with it\n", (unsigned)spinBefore, (unsigned)Profiler::spin());
  Profiler::begin();
#endif

  sandbox.setIdleScreenTitle(BootGuard::holding() ? "Saved app crashed" : "Connected");

  // Override the default /agents/<type>-agent/<id> path with the canonical
  // /devices/<id> path used by resident.inanimate.tech.
  sandbox.onTransportsWillConnect([]() {
    String wsPath = String("/devices/") + sandbox.getDeviceId();
    sandbox.ws().setEndpoint(RESIDENT_HOST, RESIDENT_PORT, wsPath.c_str());
    // Trust the roots either CA's certificate chains to, not GTS Root R4 alone (RootCerts.h).
    sandbox.ws().onConfigure([](esp_websocket_client_config_t& c) { c.cert_pem = RELAY_ROOT_CAS; });
    Serial.printf("[resident] device ID %s, WS wss://%s%s\n", sandbox.getDeviceId().c_str(),
                  RESIDENT_HOST, wsPath.c_str());
  });

  // Bench sends the time zone its apps run in before each app it mirrors
  // here, so a clock shows the same time on both screens. It comes on Bench's
  // own channel, not as a Resident `hello`: a hello would also make the board
  // drop un-channelled messages until reboot, which /resident:push-app still
  // sends. setTimezone looks the zone up once (ezTime, up to 2 s); the same
  // zone again is skipped, and a failed lookup leaves the board on UTC.
  sandbox.onMessageWithChannel("bench", [](const char*, const char* type, JsonDocument& doc) {
    if (strcmp(type, "timezone") != 0) return;
    static String applied;
    String tz = doc["data"]["tz"] | "";
    if (tz.isEmpty() || (tz == applied && sandbox.hasTimezone())) return;
    applied = tz;
    sandbox.setTimezone(tz.c_str());
  });

  appStore.begin();  // Resident doesn't start a store the board supplies
  sandbox.setup();
  printMemory("after Resident");
}

// LVGL draws as a scan starts, not every 15 ms: its own two timers (animations, the refresh) are set
// never to come due, and each scan the animations are moved to now and what changed is drawn, after
// the app's tick. A frame that takes under a scan is on the glass from the next one, every time; drawn
// on LVGL's own clock, frames reached a 42 Hz panel 33 to 60 times a second, some for one scan, some
// for two, some never. The refresh timer paused is LVGL with nothing to draw, or Resident holding it
// while an overlay has the screen.
static void lvglOnScan() {
  static uint32_t last = 0;
  if (!lv_is_initialized()) return;
  lv_display_t* disp = lv_display_get_default();
  lv_timer_t* refresh = disp ? lv_display_get_refr_timer(disp) : nullptr;
  if (!refresh) return;
  static constexpr uint32_t NEVER = 0x7FFFFFFF;
  lv_timer_set_period(refresh, NEVER);
  if (lv_anim_get_timer()) lv_timer_set_period(lv_anim_get_timer(), NEVER);
  uint32_t now = RgbPanel::latches();
  if (now == last) return;
  last = now;
  lv_timer_handler();  // an app's own timers: one of 33 ms comes due here, on every second scan, not 35 ms on
  lv_anim_refr_now();  // Resident's 5 ms grid
  if (!refresh->paused) lv_display_refr_timer(refresh);
}

void loop() {
  static uint32_t loops = 0, loopUs = 0, loopMax = 0, lastStats = 0;
  uint32_t t0 = micros();
  Lcd::service();
  sandbox.loop();
  lvglOnScan();
  Lcd::service();
  BootGuard::loop();
#ifdef BENCH_PROFILE
  Profiler::loop([](const char* code) { sandbox.loadApp(code); });
#endif
  uint32_t us = micros() - t0;
  loops++;
  loopUs += us;
  loopMax = max(loopMax, us);

  // Every 30 s: how frames are spent (Resident's loop runs Lua, LVGL's drawing and the pushes).
  if (millis() - lastStats >= 30000) {
    float secs = (millis() - lastStats) / 1000.0f;
    lastStats = millis();
    uint32_t frames, pixels, pushUs;
    Lcd::takeStats(frames, pixels, pushUs);
    static uint32_t lastScans = 0;
    uint32_t scans = RgbPanel::scans();
    Serial.printf("[perf] %.1f pushes/s, %.0f%% of the frame each, %.1f ms a push; loop %.1f ms avg, %.1f ms max; panel scanned %.1f/s; stack left %u\n",
                  frames / secs, frames ? 100.0f * pixels / frames / (Lcd::WIDTH * Lcd::HEIGHT) : 0.0f,
                  frames ? pushUs / 1000.0f / frames : 0.0f, loops ? loopUs / 1000.0f / loops : 0.0f,
                  loopMax / 1000.0f, (scans - lastScans) / secs, (unsigned)uxTaskGetStackHighWaterMark(nullptr));
    lastScans = scans;
    loops = loopUs = loopMax = 0;
  }

  static uint32_t lastBeat = 0;
  if (millis() - lastBeat >= 30000) {
    lastBeat = millis();
    Serial.printf("[heartbeat] %s, app %s, last push %lu us\n",
                  sandbox.isConnected() ? "connected" : "offline",
                  sandbox.isAppRunning() ? "running" : "idle", (unsigned long)Lcd::lastPushUs());
    printMemoryNow();
  }
}
