// Stage 3: Resident with drivers on the Waveshare ESP32 e-Paper Driver Board
// + 2.13" e-Paper (V2 panel, IL3897). Lua modules: screen (M5Stick verbs),
// lgfx (LovyanGFX-style, same frame), button (IO12: tap / hold), screens
// ("main": 122x250, 1-bit, light). Sensors and controls come from Bench while
// it mirrors an app here, so there are no drivers for them.
#include <Arduino.h>
#include <Resident.h>
#include <ResidentLgfxModule.h>
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

static Resident::SandboxConfig makeConfig() {
  Resident::SandboxConfig cfg;
  cfg.deviceType = "epd213";
  cfg.firmwareVersion = "epd213-0.1";
  lgfxModule.addDisplay("main", &lgfxMain);
  cfg.extensions = {&screenDriver, &buttonDriver, &lgfxModule};
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
  Serial.println("=== Waveshare 2.13\" e-Paper (V2): Resident + drivers ===");
  Serial.printf("Chip: %s rev %d, %d core(s) @ %lu MHz, heap %lu KB\n",
                ESP.getChipModel(), ESP.getChipRevision(), ESP.getChipCores(),
                (unsigned long)ESP.getCpuFreqMHz(),
                (unsigned long)(ESP.getFreeHeap() / 1024));

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
