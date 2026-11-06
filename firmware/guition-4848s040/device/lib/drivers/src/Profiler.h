// Where the app's core spends its time, for firmware work: built in only with -DBENCH_PROFILE
// (PLATFORMIO_BUILD_FLAGS=-DBENCH_PROFILE pio run -t upload), never in what Bench ships.
//
// A timer interrupts the loop task's core ~1000 times a second and notes where it was and who called
// that (the PC FreeRTOS saved on the way into the interrupt, and two return addresses up the stack).
// Send 'p' over serial and it samples for 8 s, then prints the addresses; ../../../prof.py on the host
// names them from firmware.elf. A sample at the ROM's _xtos_set_intlevel is one that had to wait for a
// critical section to end: its callers say whose. Other interrupts
// (the panel's refill) can't be sampled: this one waits for them, so their time shows up as nothing
// at all. spin() measures that instead: the same loop timed with and without the scan running.
//
// It also takes an app over serial, so a board needs no Wi-Fi to be measured: "L<bytes>\n" and then
// the Lua source ('s' prints spin() again; 'k' drops Wi-Fi and joins again; 'h' prints a hash of the picture after each flip, for
// checking that a change to the drawing code leaves every pixel where it was).
#pragma once
#ifdef BENCH_PROFILE
#include <Arduino.h>
#include <WiFi.h>
#include <esp_heap_caps.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include "Lcd.h"

namespace Profiler {

static constexpr int N = 8000, DEPTH = 3;
static uint32_t* s_pc = nullptr;
static volatile int s_n = -1;  // -1: not sampling
static hw_timer_t* s_timer = nullptr;

static void IRAM_ATTR onTimer() {
  int n = s_n;
  if (n < 0 || n >= N) return;
  // The interrupted task's stack top is the frame its registers were saved in: exit, pc, ps, a0, a1.
  // Its callers' windows were spilled to the stack on the way in: under each frame's stack pointer
  // lie the caller's a0 (its return address) and a1 (its stack pointer).
  uint32_t* frame = *(uint32_t**)xTaskGetCurrentTaskHandle();
  uint32_t* rec = s_pc + n * DEPTH;
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
  s_n = n + 1;
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
  while (Serial.available()) {
    int c = Serial.read();
    if (c == 'p' && s_n < 0) {
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
  Serial.printf("[prof] begin %d x %d\n", N, DEPTH);
  for (int i = 0; i < N * DEPTH; i += 15) {  // five samples a line
    char line[15 * 9 + 2];
    int k = 0;
    for (int j = i; j < i + 15 && j < N * DEPTH; j++) k += snprintf(line + k, sizeof(line) - k, "%08x ", (unsigned)s_pc[j]);
    Serial.println(line);
  }
  Serial.println("[prof] end");
  s_n = -1;
}

}  // namespace Profiler
#endif
