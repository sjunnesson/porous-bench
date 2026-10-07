// Stage 3 + lvgl: Resident with drivers on the Waveshare ESP32 e-Paper Driver Board
// + 2.13" e-Paper (V2 panel, IL3897). Lua modules: screen (M5Stick verbs),
// lgfx (LovyanGFX-style, same frame), lvgl (LVGL 9 via luavgl; renders
// RGB565 and the panel thresholds it into the same frame), button (IO12:
// tap / hold), screens
// ("main": 122x250, 1-bit, light). Sensors and controls come from Bench while
// it mirrors an app here, so there are no drivers for them.
#include <Arduino.h>
#include <Resident.h>
#include <ResidentLgfxModule.h>
#include <ResidentLvglModule.h>
#include "EpdFrame.h"
#include "ScreenDriver.h"
#include "CanvasLgfxTarget.h"
#include "ButtonsDriver.h"

static constexpr const char* RESIDENT_HOST = "resident.inanimate.tech";
static constexpr uint16_t RESIDENT_PORT = 443;
static constexpr uint8_t BUTTON_PIN = 12;  // the board's IO12 key

ScreenDriver screenDriver;
ButtonsDriver buttonDriver{BUTTON_PIN};
CanvasLgfxTarget lgfxMain;
Resident::LgfxModule lgfxModule;
Resident::LvglModule lvglModule;

static Resident::SandboxConfig makeConfig() {
  Resident::SandboxConfig cfg;
  cfg.deviceType = "epd213";
  cfg.firmwareVersion = "epd213-0.1-lvgl";
  lgfxModule.addDisplay("main", &lgfxMain);
  // LVGL's display and its draw buffer (a tenth of the screen: 25 rows,
  // 6 KB) are only allocated when an app first calls lvgl.bind("main").
  lvglModule.addDisplay("main");
  cfg.extensions = {&screenDriver, &buttonDriver, &lgfxModule, &lvglModule};
  cfg.systemDisplay = &screenDriver;
  cfg.systemButton = &buttonDriver;  // tap = load the saved app now, hold = forget it

  // Courier::Config has a constructor with default args, so designated
  // initializers don't compile under strict ESP-IDF builds.
  Courier::Config courier;
  courier.host = RESIDENT_HOST;
  courier.port = RESIDENT_PORT;
  cfg.network = courier;
  return cfg;
}

Resident::Sandbox sandbox{makeConfig()};

#ifdef MEM_PROBE
// Diagnostics: free heap and the largest free block, sampled every 10 ms on
// a low-priority task; each second's low points go to serial.
static void memProbe(void*) {
  for (;;) {
    uint32_t lowFree = UINT32_MAX, lowBlock = UINT32_MAX;
    for (int i = 0; i < 100; i++) {
      lowFree = min(lowFree, (uint32_t)heap_caps_get_free_size(MALLOC_CAP_8BIT));
      lowBlock = min(lowBlock, (uint32_t)heap_caps_get_largest_free_block(MALLOC_CAP_8BIT));
      vTaskDelay(pdMS_TO_TICKS(10));
    }
    Serial.printf("[mem] low free %u, low largest block %u\n", lowFree, lowBlock);
  }
}
#endif

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println();
  Serial.println("=== Waveshare 2.13\" e-Paper (V2): Resident + drivers ===");
  Serial.printf("Chip: %s rev %d, %d core(s) @ %lu MHz, heap %lu KB\n",
                ESP.getChipModel(), ESP.getChipRevision(), ESP.getChipCores(),
                (unsigned long)ESP.getCpuFreqMHz(),
                (unsigned long)(ESP.getFreeHeap() / 1024));

#ifdef MEM_PROBE
  xTaskCreatePinnedToCore(memProbe, "memprobe", 2560, nullptr, 1, nullptr, 0);
#endif
#ifdef MEM_PROBE
  {
    uint32_t a = ESP.getFreeHeap();
    lv_init();
    Serial.printf("[mem] lv_init took %ld bytes\n", (long)a - (long)ESP.getFreeHeap());
  }
#endif
  EpdFrame::begin();  // panel up before Resident paints its first status

  sandbox.setIdleScreenTitle("Connected");

  // Override the default /agents/<type>-agent/<id> path with the canonical
  // /devices/<id> path used by resident.inanimate.tech.
  sandbox.onTransportsWillConnect([]() {
    String wsPath = String("/devices/") + sandbox.getDeviceId();
    sandbox.ws().setEndpoint(RESIDENT_HOST, RESIDENT_PORT, wsPath.c_str());
    Serial.printf("[resident] device ID %s, WS wss://%s%s\n",
                  sandbox.getDeviceId().c_str(), RESIDENT_HOST, wsPath.c_str());
  });

  sandbox.setup();
}

void loop() {
  sandbox.loop();

  static uint32_t lastBeat = 0;
  if (millis() - lastBeat >= 30000) {
    lastBeat = millis();
    Serial.printf("[heartbeat] %s, app %s, heap %lu (min %lu)\n",
                  sandbox.isConnected() ? "connected" : "offline",
                  sandbox.isAppRunning() ? "running" : "idle",
                  (unsigned long)ESP.getFreeHeap(), (unsigned long)ESP.getMinFreeHeap());
  }
}
