// Where Resident keeps the last app for the next boot: a file on the 12 MB
// LittleFS partition instead of an NVS blob.
//
// A flash write stops the cache, and with it the PSRAM the panel is scanned
// from: the picture glitches while it writes. On this board it comes back by
// itself, in place, so nothing needs doing after a save (stage 1's FLASH test,
// 2026-10-26: seven 256 KB writes of up to 2.5 s, the border intact after each).
//
// Resident saves an app that loaded cleanly so a reboot brings it back, by
// default into NVS. The NVS partition is 20 KB and also holds Wi-Fi and the
// `store` module: on the S3-Touch-LCD-2 a 17 KB app failed to save
// ("persist_too_big", silent) and a reboot brought back an older, smaller one.
// Here the app goes to /app.lua from the start; the `store` module's data
// stays in NVS.
//
// Resident doesn't call begin() on a store the board supplies: main.cpp does,
// before sandbox.setup().
#pragma once
#include <LittleFS.h>
#include <ResidentNvsStore.h>

class AppStore : public Resident::NvsPersistentStore {
public:
  bool begin() override {
    bool nvs = NvsPersistentStore::begin();
    _fs = LittleFS.begin(true);  // the "spiffs" partition, formatted the first time
    Serial.printf("[store] apps saved to %s\n", _fs ? "LittleFS" : "NVS (LittleFS didn't mount)");
    return nvs;
  }

  bool save(const char* source, size_t len) override {
    if (!_fs) return NvsPersistentStore::save(source, len);
    File f = LittleFS.open(PATH, "w");
    if (!f) return false;
    bool ok = f.write((const uint8_t*)source, len) == len;
    f.close();
    if (ok) NvsPersistentStore::clear();  // an older copy in NVS would only confuse a fallback
    Serial.printf("[store] app saved: %u bytes\n", (unsigned)len);
    return ok;
  }

  String load() override {
    if (_fs && LittleFS.exists(PATH)) {
      File f = LittleFS.open(PATH, "r");
      String s = f.readString();
      f.close();
      Serial.printf("[store] app loaded: %u bytes\n", (unsigned)s.length());
      return s;
    }
    return NvsPersistentStore::load();  // saved before this firmware
  }

  void clear() override {
    if (_fs) LittleFS.remove(PATH);
    NvsPersistentStore::clear();
  }

private:
  static constexpr const char* PATH = "/app.lua";
  bool _fs = false;
};
