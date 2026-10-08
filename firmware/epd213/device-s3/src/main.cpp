// Resident with drivers and LVGL on an ESP32-S3 with PSRAM driving a Waveshare
// 2.13" e-Paper module. Lua modules: screen (M5Stick verbs), lgfx
// (LovyanGFX-style, same frame), lvgl (LVGL 9 via luavgl; renders RGB565 and
// the panel thresholds it into the same frame), button (keys A and B: tap /
// hold), screens ("main": 122x250, 1-bit, light). Pins and panel generation
// come from build flags (BoardConfig.h). Sensors and controls come from
// Bench while it mirrors an app here, so there are no drivers for them.
#include <Arduino.h>
#include <Resident.h>
#include <ResidentLgfxModule.h>
#include <ResidentLvglModule.h>
#include "EpdFrame.h"
#include "ScreenDriver.h"
#include "CanvasLgfxTarget.h"
#include "ButtonsDriver.h"
#include "BoardConfig.h"

static constexpr const char* RESIDENT_HOST = "resident.inanimate.tech";
static constexpr uint16_t RESIDENT_PORT = 443;

ScreenDriver screenDriver;
ButtonsDriver buttonDriver{BUTTON_A, BUTTON_B};
CanvasLgfxTarget lgfxMain;
Resident::LgfxModule lgfxModule;
Resident::LvglModule lvglModule;

static Resident::SandboxConfig makeConfig() {
  Resident::SandboxConfig cfg;
  cfg.deviceType = "epd213";
  cfg.firmwareVersion = "epd213-s3-0.1";
  lgfxModule.addDisplay("main", &lgfxMain);
  // LVGL's display and its draw buffer (a tenth of the screen) are only
  // allocated when an app first calls lvgl.bind("main").
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

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println();
  Serial.println("=== Waveshare 2.13\" e-Paper on ESP32-S3: Resident + drivers + lvgl ===");
  Serial.printf("Chip: %s rev %d, %d core(s) @ %lu MHz, heap %lu KB\n",
                ESP.getChipModel(), ESP.getChipRevision(), ESP.getChipCores(),
                (unsigned long)ESP.getCpuFreqMHz(),
                (unsigned long)(ESP.getFreeHeap() / 1024));
  Serial.printf("PSRAM: %lu KB (%lu KB free)\n", (unsigned long)(ESP.getPsramSize() / 1024),
                (unsigned long)(ESP.getFreePsram() / 1024));

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

  sandbox.setup();
}

void loop() {
  sandbox.loop();

  static uint32_t lastBeat = 0;
  if (millis() - lastBeat >= 30000) {
    lastBeat = millis();
    Serial.printf("[heartbeat] %s, app %s, internal %lu, psram %lu\n",
                  sandbox.isConnected() ? "connected" : "offline",
                  sandbox.isAppRunning() ? "running" : "idle",
                  (unsigned long)heap_caps_get_free_size(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT),
                  (unsigned long)ESP.getFreePsram());
  }
}
