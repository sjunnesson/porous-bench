// The relay's TLS keeps its record buffers in PSRAM. Arduino's prebuilt core has mbedTLS allocate from
// internal RAM (CONFIG_MBEDTLS_INTERNAL_MEM_ALLOC), about 40 KB for a session, the same RAM LVGL's
// objects and draw buffer want; with too little left, connecting fails (mbedtls_ssl_setup returned
// -0x008D, measured) and the board stays off the relay. This needs no core rebuild. Call it first thing
// in setup(), before anything has opened TLS, so everything mbedTLS frees came from here.
#pragma once
#include <esp_heap_caps.h>
#include <mbedtls/platform.h>

namespace TlsInPsram {

inline void* calloc_(size_t n, size_t size) {
  void* p = heap_caps_calloc(n, size, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
  return p ? p : heap_caps_calloc(n, size, MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);
}

inline void begin() { mbedtls_platform_set_calloc_free(calloc_, heap_caps_free); }

}  // namespace TlsInPsram
