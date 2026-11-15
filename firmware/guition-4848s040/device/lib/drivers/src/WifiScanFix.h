// A scan for Wi-Fi networks crashed the board, every time, in the Wi-Fi library (scan_parse_beacon: a
// jump to 0xbaad5678, the heap's mark at a block's end; 2026-11-15). WiFiManager's portal scans as
// it opens, so a board with no network saved could not be given one, and an app that lists networks
// crashed the board as it asked.
//
// The Wi-Fi library asks the supplicant what a network's security is through a table of functions,
// and for each network a scan hears it calls the table's 28th, wpa_parse_wpa_ie_scan_only. The
// ESP-IDF that pioarduino rebuilds the SDK from (platformio.ini's custom_sdkconfig) is older than the
// Wi-Fi library it links, which comes only as a binary, and its supplicant's table has 27: the call
// went to whatever lay past the table's end. Joining a saved network never makes that call.
//
// So the library is handed a table of 28, the 28th being the function that parses the same element
// when joining. Call it once Wi-Fi has been started (after sandbox.setup(), or after WiFi.mode()) and
// before anything scans. It does nothing while Wi-Fi isn't started, when it has been done, or once
// the SDK's own table is no longer the short one, as when the core is no longer rebuilt, or is
// rebuilt from an ESP-IDF as new as the library.
#pragma once
#include <Arduino.h>
#include <esp_heap_caps.h>
#include <string.h>

extern "C" {
extern void** wpa_cb;  // the supplicant's table (ESP-IDF's esp_wpa_main.c)
int esp_wifi_register_wpa_cb_internal(void* table);
}

namespace WifiScanFix {

// True if the library has a table of 28 from here.
inline bool begin() {
  static constexpr int HAS = 27, PARSE_IE = 15;  // the short table's length; wpa_parse_wpa_ie in it
  static void* table[HAS + 1];
  if (table[0]) return true;
  if (!wpa_cb || heap_caps_get_allocated_size(wpa_cb) != HAS * sizeof(void*)) return false;
  memcpy(table, wpa_cb, HAS * sizeof(void*));
  table[HAS] = table[PARSE_IE];
  esp_wifi_register_wpa_cb_internal(table);
  Serial.println("[wifi] the supplicant's table lengthened for scans (WifiScanFix.h)");
  return true;
}

}  // namespace WifiScanFix
