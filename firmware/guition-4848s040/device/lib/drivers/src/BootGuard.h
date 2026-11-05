// A saved app that crashes the board comes back at every boot and crashes it again: the board reboots
// for ever, reachable only in the moment before the app loads. A Lua error can't do this, but LVGL
// overflowing the stack can, and so can Lua nesting too many C calls on a small stack (a recursive pcall
// or __index panics a C6 at ~9 levels). So two crashes in a row, each within a minute of
// booting, and the next boot stays on the idle screen. The saved app stays saved and a new push runs as
// usual; a reset or a power cycle tries the saved app again. The count lives in RTC memory, which a
// crash doesn't clear. It's meant for one file: main.cpp, through the store it wraps.
#pragma once
#include <Arduino.h>
#include <esp_attr.h>
#include <esp_system.h>

namespace BootGuard {

static RTC_NOINIT_ATTR uint32_t s_magic;
static RTC_NOINIT_ATTR uint32_t s_crashes;
static bool s_holding = false;

// Call it first in setup().
inline void begin() {
  const esp_reset_reason_t why = esp_reset_reason();
  const bool crashed = why == ESP_RST_PANIC || why == ESP_RST_INT_WDT || why == ESP_RST_TASK_WDT || why == ESP_RST_WDT;
  if (s_magic != 0xB007C0DE) s_magic = 0xB007C0DE, s_crashes = 0;
  s_crashes = crashed ? s_crashes + 1 : 0;
  s_holding = s_crashes >= 2;
  if (s_crashes) Serial.printf("[guard] crash %u in a row (reset reason %d)%s\n", (unsigned)s_crashes, (int)why,
                               s_holding ? ": not loading the saved app" : "");
}

// Should the saved app stay out of this boot?
inline bool holding() { return s_holding; }

// Call it in loop(): a minute up and the app wasn't what brought the board down.
inline void loop() {
  if (s_crashes && millis() > 60000) s_crashes = 0;
}

}  // namespace BootGuard
