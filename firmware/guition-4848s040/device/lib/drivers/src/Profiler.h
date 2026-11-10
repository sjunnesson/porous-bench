// Where the app's core spends its time, for firmware work: built in only with -DBENCH_PROFILE
// (PLATFORMIO_BUILD_FLAGS=-DBENCH_PROFILE pio run -t upload), never in what Bench ships. The same
// file on each board that has it, but for the watch on interrupts below, which only this panel needs.
//
// A timer interrupts the loop task's core ~1000 times a second and notes where it was and who called
// that (the PC FreeRTOS saved on the way into the interrupt, and two return addresses up the stack).
// Send 'p' over serial and it samples for 8 s, then prints the addresses; firmware/prof.py on the host
// names them from firmware.elf. A sample at the ROM's _xtos_set_intlevel is one that had to wait for a
// critical section to end: its callers say whose. Other interrupts can't be sampled: this one waits
// for them, so their time shows up as nothing at all. spin() measures that instead: the same loop
// timed with and without them running.
//
// The same timer watches for interrupts held off: it should run every 997 us, so a longer gap is time
// this core couldn't take an interrupt, and the panel's refill can't afford more than ~450 us of that.
// Each gap over GAP_US prints as "[gap]", with where the task was when interrupts came back and who
// called that; 'x' holds them off for 9 ms on purpose, to see what the panel does. "[scan]" lines say
// when a frame's refills went short (RgbPanel::scanEvent).
//
// It also takes an app over serial, so a board needs no Wi-Fi to be measured: "L<bytes>\n" and then
// the Lua source ('s' prints spin() again; 'k' drops Wi-Fi and joins again; 'h' prints a hash of the
// picture after each flip, for checking that a change to the drawing code leaves every pixel where it
// was).
#pragma once
#ifdef BENCH_PROFILE
#include <Arduino.h>
#include <WiFi.h>
#include <esp_cpu.h>
#include <esp_heap_caps.h>
#include <esp_rom_sys.h>
#include <esp_timer.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include "Lcd.h"
#include <RgbPanel.h>

namespace Profiler {

static constexpr int N = 8000, DEPTH = 3;
static uint32_t* s_pc = nullptr;
static volatile int s_n = -1;  // -1: not sampling
static hw_timer_t* s_timer = nullptr;

static constexpr uint32_t GAP_US = 1800;
struct Gap { uint32_t ms, us, stack[DEPTH]; };
static Gap s_gaps[32];
static volatile uint32_t s_gapN = 0;
static uint32_t s_lastCycles = 0;

static void IRAM_ATTR onTimer() {
  uint32_t now = esp_cpu_get_cycle_count(), us = (now - s_lastCycles) / 240;
  bool gap = s_lastCycles && us > GAP_US;
  s_lastCycles = now;
  int n = s_n;
  bool sampling = n >= 0 && n < N;
  if (!gap && !sampling) return;
  // The interrupted task's stack top is the frame its registers were saved in: exit, pc, ps, a0, a1.
  // Its callers' windows were spilled to the stack on the way in: under each frame's stack pointer
  // lie the caller's a0 (its return address) and a1 (its stack pointer).
  uint32_t* frame = *(uint32_t**)xTaskGetCurrentTaskHandle();
  uint32_t here[DEPTH];
  uint32_t* rec = here;
  uint32_t a0 = frame[3], sp = frame[4];
  rec[0] = frame[1];
  for (int d = 1; d < DEPTH; d++) {
    rec[d] = a0 ? (a0 & 0x3fffffff) | 0x40000000 : 0;
    if (!a0 || (sp & 3) || sp < 0x3fc88000 || sp >= 0x3fd00000) {
      a0 = 0;
      continue;
    }
    a0 = *(uint32_t*)(sp - 16);
    uint32_t up = *(uint32_t*)(sp - 12);
    if (up <= sp) a0 = 0;
    sp = up;
  }
  if (gap) {
    uint32_t g = s_gapN;
    Gap& e = s_gaps[g % 32];
    e.ms = (uint32_t)(esp_timer_get_time() / 1000), e.us = us;
    for (int d = 0; d < DEPTH; d++) e.stack[d] = here[d];
    s_gapN = g + 1;
  }
  if (sampling) {
    for (int d = 0; d < DEPTH; d++) s_pc[n * DEPTH + d] = here[d];
    s_n = n + 1;
  }
}

// A loop that touches no memory: how long it takes says how much of the core is left to the app.
inline uint32_t spin() {
  uint32_t t0 = micros();
  volatile uint32_t x = 0;
  for (uint32_t i = 0; i < 4000000; i++) x = x + i;
  return micros() - t0;
}

inline void begin() {
  Serial.setTimeout(3000);
  s_pc = (uint32_t*)heap_caps_malloc(N * DEPTH * 4, MALLOC_CAP_SPIRAM);
  s_timer = timerBegin(1000000);
  timerAttachInterrupt(s_timer, onTimer);
  timerAlarm(s_timer, 997, true, 0);  // not a round number: it mustn't keep step with a 15 or 33 ms frame
  Serial.printf("[prof] ready on core %d: send 'p'\n", xPortGetCoreID());
}

inline void loop(void (*load)(const char*)) {
  static uint32_t gapsShown = 0, scansShown = 0, lastScanLine = 0;
  for (; gapsShown < s_gapN; gapsShown++) {
    if (s_gapN - gapsShown > 32) gapsShown = s_gapN - 32;
    const Gap& e = s_gaps[gapsShown % 32];
    Serial.printf("[gap] %u ms: %u us, at %08x from %08x %08x\n", (unsigned)e.ms, (unsigned)e.us, (unsigned)e.stack[0],
                  (unsigned)e.stack[1], (unsigned)e.stack[2]);
  }
  RgbPanel::ScanEvent se;
  for (uint32_t total = RgbPanel::scanEvents(); scansShown < total; scansShown++) {
    if (RgbPanel::scanEvent(scansShown, se)) {
      Serial.printf("[scan] %u ms: %u refills in a frame, count at the vertical sync %s\n", (unsigned)se.ms, (unsigned)se.got, se.odd ? "odd" : "even");
    }
  }
  if (millis() - lastScanLine >= 5000) {
    lastScanLine = millis();
    Serial.printf("[scan] %u short frames, %u gaps\n", (unsigned)RgbPanel::scanEvents(), (unsigned)s_gapN);
  }
  while (Serial.available()) {
    int c = Serial.read();
    if (c == 'x') {  // what a long critical section does to the picture
      Serial.printf("[prof] interrupts off for 9 ms at %u ms\n", (unsigned)millis());
      portDISABLE_INTERRUPTS();
      esp_rom_delay_us(9000);
      portENABLE_INTERRUPTS();
    } else if (c == 'p' && s_n < 0) {
      Serial.println("[prof] sampling");
      s_n = 0;
    } else if (c == 'h') {
      Lcd::hashFlips = !Lcd::hashFlips;
      Serial.printf("[prof] a hash after each flip: %s\n", Lcd::hashFlips ? "on" : "off");
    } else if (c == 'k') {  // off Wi-Fi and back: does the relay's connection come back with this app running?
      Serial.printf("[prof] dropping Wi-Fi; internal free %u, largest %u\n",
                    (unsigned)heap_caps_get_free_size(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT),
                    (unsigned)heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT));
      WiFi.disconnect(false, false);
      delay(500);
      WiFi.reconnect();
    } else if (c == 'c') {  // "c17000000\n": the pixel clock, from the next vertical sync
      uint32_t hz = Serial.parseInt();
      Serial.read();
      RgbPanel::setPixelClock(hz);
      Serial.printf("[prof] pixel clock %u Hz\n", (unsigned)hz);
    } else if (c == 'f') {  // how long frames stayed on the glass since the last 'f'
      static uint32_t lastMs = 0, lastScans = 0;
      uint32_t held[5], ms = millis(), scans = RgbPanel::scans();
      Lcd::takeHeld(held);
      Serial.printf("[pace] %.1f s, scanned %.2f/s; frames held 0/1/2/3/4+ scans: %u %u %u %u %u\n", (ms - lastMs) / 1000.0f,
                    (scans - lastScans) * 1000.0f / (ms - lastMs), (unsigned)held[0], (unsigned)held[1], (unsigned)held[2],
                    (unsigned)held[3], (unsigned)held[4]);
      lastMs = ms, lastScans = scans;
    } else if (c == 's') {
      Serial.printf("[prof] spin %u us\n", (unsigned)spin());
    } else if (c == 'L') {
      size_t len = Serial.parseInt();
      Serial.read();  // the newline
      char* code = len && len < 200000 ? (char*)heap_caps_malloc(len + 1, MALLOC_CAP_SPIRAM) : nullptr;
      size_t got = code ? Serial.readBytes(code, len) : 0;
      if (got == len && code) {
        code[len] = 0;
        Serial.printf("[prof] app over serial: %u bytes\n", (unsigned)len);
        load(code);
      } else {
        Serial.printf("[prof] app over serial: got %u of %u bytes\n", (unsigned)got, (unsigned)len);
      }
      free(code);
    }
  }
  if (s_n < N) return;
#if ARDUINO_USB_CDC_ON_BOOT
  Serial.setTxTimeoutMs(200);  // a board that drops prints nobody reads (its own USB): not these
#endif
  Serial.printf("[prof] begin %d x %d\n", N, DEPTH);
  for (int i = 0; i < N * DEPTH; i += 15) {  // five samples a line
    char line[15 * 9 + 2];
    int k = 0;
    for (int j = i; j < i + 15 && j < N * DEPTH; j++) k += snprintf(line + k, sizeof(line) - k, "%08x ", (unsigned)s_pc[j]);
    Serial.println(line);
  }
  Serial.println("[prof] end");
#if ARDUINO_USB_CDC_ON_BOOT
  Serial.setTxTimeoutMs(0);
#endif
  s_n = -1;
}

}  // namespace Profiler
#endif
