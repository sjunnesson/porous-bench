// Stage 2: Resident on the Waveshare ESP32 e-Paper Driver Board + 2.13"
// e-Paper (V2 panel, IL3897). Wi-Fi through WiFiManager's captive portal,
// WebSocket to resident.inanimate.tech/devices/<id>, connection status and
// the device ID on the panel. Apps get only the built-in modules (log, time,
// store, events, ...); hardware modules come in stage 3.
#include <Arduino.h>
#include <Adafruit_GFX.h>
#include <Resident.h>
#include "Epd213.h"

static constexpr const char* RESIDENT_HOST = "resident.inanimate.tech";
static constexpr uint16_t RESIDENT_PORT = 443;
static constexpr int BUTTON_PIN = 12;  // the board's IO12 key

static Epd213 epd({/*din*/ 14, /*clk*/ 13, /*cs*/ 15, /*dc*/ 27, /*rst*/ 26, /*busy*/ 25});
static GFXcanvas1 canvas(Epd213::WIDTH, Epd213::HEIGHT);
static constexpr uint16_t BLACK = 0, WHITE = 1;

// Paints Resident's status strings: "WiFi...", "Configure WiFi\n\n<AP>",
// "Connecting...", and once connected the idle screen
// "Connected\nDevice ID: <id>\nType: epd213[\n<n>s]". Each call is one
// partial refresh (~0.2 s); every 10th is a full one to clear ghosting.
class EpdStatusDisplay : public Resident::SystemDisplay {
public:
  const char* name() const override { return "status"; }

  void displayText(const char* text) override {
    Serial.printf("[status] %s\n", text);
    const int W = Epd213::WIDTH;
    canvas.fillScreen(WHITE);
    canvas.setTextColor(BLACK);
    canvas.setTextWrap(true);

    canvas.setTextSize(2);
    canvas.setCursor(4, 6);
    canvas.print("Resident");
    canvas.setTextSize(1);
    canvas.setCursor(4, 26);
    canvas.print("2.13\" e-Paper");
    canvas.drawFastHLine(0, 38, W, BLACK);

    int y = 48;
    String all(text);
    int start = 0;
    bool first = true;
    while (start <= (int)all.length()) {
      int nl = all.indexOf('\n', start);
      String line = all.substring(start, nl < 0 ? all.length() : nl);
      start = nl < 0 ? all.length() + 1 : nl + 1;

      if (line.startsWith("Device ID: ")) {
        canvas.setTextSize(1);
        canvas.setCursor(4, y);
        canvas.print("Device ID");
        y += 12;
        canvas.fillRect(0, y - 3, W, 22, BLACK);  // the string to read off
        canvas.setTextColor(WHITE);
        canvas.setTextSize(2);
        canvas.setCursor(4, y);
        canvas.print(line.substring(11));
        canvas.setTextColor(BLACK);
        y += 26;
      } else {
        // A short first line is the headline; everything else is small.
        uint8_t size = (first && line.length() <= 10) ? 2 : 1;
        canvas.setTextSize(size);
        canvas.setCursor(4, y);
        canvas.print(line);
        int lineH = 8 * size + 4;
        int chars = (W - 4) / (6 * size);
        y += lineH * max(1, (int)((line.length() + chars - 1) / chars));
        if (line.length() == 0) y -= lineH / 2;
      }
      first = false;
    }
    epd.show(canvas.getBuffer());
  }
};

// IO12 as Resident's system button: during the boot countdown a tap loads
// the saved app now, a long press forgets it. The key pulls IO12 to GND and
// the board has no pull-up on it (IO12 is a boot strap that must read low at
// reset), so the internal pull-up goes on once we're running.
class Io12Button : public Resident::SystemButton {
public:
  const char* name() const override { return "system_button"; }
  void begin() override {
    pinMode(BUTTON_PIN, INPUT_PULLUP);
    Serial.printf("[button] IO12 idle level %d\n", digitalRead(BUTTON_PIN));
  }
  bool pressed() override {
    bool raw = digitalRead(BUTTON_PIN) == LOW;
    uint32_t now = millis();
    if (raw != _raw) { _raw = raw; _changedMs = now; }
    if (now - _changedMs >= 20 && _stable != _raw) {
      _stable = _raw;
      Serial.printf("[button] IO12 %s\n", _stable ? "down" : "up");
    }
    return _stable;
  }
private:
  bool _raw = false, _stable = false;
  uint32_t _changedMs = 0;
};

static EpdStatusDisplay statusDisplay;
static Io12Button systemButton;

static Resident::SandboxConfig makeConfig() {
  Resident::SandboxConfig cfg;
  cfg.deviceType = "epd213";
  cfg.firmwareVersion = "epd213-stage2";
  cfg.systemDisplay = &statusDisplay;
  cfg.systemButton = &systemButton;

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
  Serial.println("=== Waveshare 2.13\" e-Paper (V2): Resident ===");
  Serial.printf("Chip: %s rev %d, %d core(s) @ %lu MHz, heap %lu KB\n",
                ESP.getChipModel(), ESP.getChipRevision(), ESP.getChipCores(),
                (unsigned long)ESP.getCpuFreqMHz(),
                (unsigned long)(ESP.getFreeHeap() / 1024));

  epd.begin();
  epd.setFullEvery(10);

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
  systemButton.pressed();  // keeps the serial log of IO12 alive outside the countdown

  static uint32_t lastBeat = 0;
  if (millis() - lastBeat >= 30000) {
    lastBeat = millis();
    Serial.printf("[heartbeat] %s, heap %lu\n",
                  sandbox.isConnected() ? "connected" : "offline",
                  (unsigned long)ESP.getFreeHeap());
  }
}
