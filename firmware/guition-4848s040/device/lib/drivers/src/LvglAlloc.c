// Where LVGL's memory comes from. Its objects and draw tasks are small and it walks them all the time,
// so they want internal RAM, but internal RAM is also what Wi-Fi and the relay's connection need: with
// too little left a board can't connect (mbedtls_ssl_setup returned -0x008D at 57 KB free, measured on
// the Guition), and plain malloc lets LVGL take it all before PSRAM. So small blocks are internal down to
// a floor and go to PSRAM past it: slower, but 900 objects stop at 46 KB free and the board stays on the
// relay. It replaces plain malloc through LV_STDLIB_CUSTOM in lv_conf.h.
#include <lvgl.h>
#if LV_USE_STDLIB_MALLOC == LV_STDLIB_CUSTOM
#include <esp_heap_caps.h>

#define INTERNAL (MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT)
static const size_t SMALL = 4096;             // what's bigger is PSRAM's anyway (CONFIG_SPIRAM_MALLOC_ALWAYSINTERNAL)
static const size_t FLOOR = 48 * 1024;

void lv_mem_init(void) {}
void lv_mem_deinit(void) {}
lv_mem_pool_t lv_mem_add_pool(void* mem, size_t bytes) {
  LV_UNUSED(mem);
  LV_UNUSED(bytes);
  return NULL;
}
void lv_mem_remove_pool(lv_mem_pool_t pool) { LV_UNUSED(pool); }

void* lv_malloc_core(size_t size) {
  if (size <= SMALL && heap_caps_get_free_size(INTERNAL) > FLOOR) {
    void* p = heap_caps_malloc(size, INTERNAL);
    if (p) return p;
  }
  void* p = heap_caps_malloc(size, MALLOC_CAP_SPIRAM);
  return p ? p : heap_caps_malloc(size, INTERNAL);
}
void* lv_realloc_core(void* p, size_t new_size) {
  if (!p) return lv_malloc_core(new_size);
  return heap_caps_realloc(p, new_size, MALLOC_CAP_8BIT);
}
void lv_free_core(void* p) { heap_caps_free(p); }
void lv_mem_monitor_core(lv_mem_monitor_t* mon_p) { LV_UNUSED(mon_p); }
lv_result_t lv_mem_test_core(void) { return LV_RESULT_OK; }

#endif
