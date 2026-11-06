// Where LVGL's memory comes from (LV_STDLIB_CUSTOM in lv_conf.h).
//
// LVGL allocates all the time: two blocks for every shape it draws, freed a moment later. Through the
// system heap each of those walks the list of heaps and takes the heap's lock with interrupts off, and
// a profile of Patterns had the app's core waiting on that lock 7.5% of the time. So small blocks come
// from pools of LVGL's own: 32 KB chunks of internal RAM, each a heap with no lock (LVGL runs on one
// task; nothing else may call lv_malloc).
//
// Internal RAM is also what Wi-Fi and the relay's connection need: with too little left a board can't
// connect (mbedtls_ssl_setup returned -0x008D at 57 KB free, measured). A chunk is only taken while that
// leaves FLOOR free, and given back once it's empty; past that, and for big blocks, memory comes from the
// system heap, PSRAM first: slower, but 900 objects leave the board on the relay. And none is taken
// until an app uses LVGL: what it allocates when the board starts (some 2 KB; EARLY at most) comes from
// the system heap, so an app that draws with lgfx keeps the 32 KB.
#include <lvgl.h>
#if LV_USE_STDLIB_MALLOC == LV_STDLIB_CUSTOM
#include <string.h>
#include <esp_heap_caps.h>
#include <multi_heap.h>

#define INTERNAL (MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT)
#define SMALL 4096            // what's bigger is PSRAM's anyway (CONFIG_SPIRAM_MALLOC_ALWAYSINTERNAL)
#define FLOOR (48 * 1024)
#define CHUNK (32 * 1024)
#define MAX_CHUNKS 6
#define EARLY 8192

static struct {
  uint8_t* mem;
  multi_heap_handle_t heap;
  size_t empty;  // its free bytes with nothing in it
} s_chunk[MAX_CHUNKS];
static int s_chunks = 0;
static size_t s_early = 0;  // taken from the system heap before the first chunk

static int chunk_of(const void* p) {
  for (int i = 0; i < s_chunks; i++) {
    if ((const uint8_t*)p >= s_chunk[i].mem && (const uint8_t*)p < s_chunk[i].mem + CHUNK) return i;
  }
  return -1;
}

static void* pool_malloc(size_t size) {
  for (int i = 0; i < s_chunks; i++) {
    void* p = multi_heap_malloc(s_chunk[i].heap, size);
    if (p) return p;
  }
  if (s_chunks == MAX_CHUNKS || heap_caps_get_free_size(INTERNAL) < FLOOR + CHUNK) return NULL;
  uint8_t* mem = heap_caps_malloc(CHUNK, INTERNAL);
  if (!mem) return NULL;
  multi_heap_handle_t heap = multi_heap_register(mem, CHUNK);  // no lock: multi_heap_set_lock isn't called
  if (!heap) {
    heap_caps_free(mem);
    return NULL;
  }
  s_chunk[s_chunks].mem = mem;
  s_chunk[s_chunks].heap = heap;
  s_chunk[s_chunks].empty = multi_heap_free_size(heap);
  s_chunks++;
  return multi_heap_malloc(heap, size);
}

void lv_mem_init(void) {}
void lv_mem_deinit(void) {}
lv_mem_pool_t lv_mem_add_pool(void* mem, size_t bytes) {
  LV_UNUSED(mem);
  LV_UNUSED(bytes);
  return NULL;
}
void lv_mem_remove_pool(lv_mem_pool_t pool) { LV_UNUSED(pool); }

void* lv_malloc_core(size_t size) {
  if (size <= SMALL) {
    if (s_chunks == 0 && s_early + size <= EARLY) {
      void* p = heap_caps_malloc(size, INTERNAL);
      if (p) {
        s_early += size;
        return p;
      }
    }
    void* p = pool_malloc(size);
    if (p) return p;
  }
  void* p = heap_caps_malloc(size, MALLOC_CAP_SPIRAM);
  return p ? p : heap_caps_malloc(size, INTERNAL);
}

void lv_free_core(void* p) {
  int i = chunk_of(p);
  if (i < 0) {
    heap_caps_free(p);
    return;
  }
  multi_heap_free(s_chunk[i].heap, p);
  // The last chunk goes back once it's empty, unless the one before is nearly full (it would only be
  // taken again for the next block).
  int last = s_chunks - 1;
  if (last > 0 && multi_heap_free_size(s_chunk[last].heap) == s_chunk[last].empty &&
      multi_heap_free_size(s_chunk[last - 1].heap) > CHUNK / 4) {
    heap_caps_free(s_chunk[last].mem);
    s_chunks--;
  }
}

void* lv_realloc_core(void* p, size_t new_size) {
  if (!p) return lv_malloc_core(new_size);
  int i = chunk_of(p);
  if (i < 0) return heap_caps_realloc(p, new_size, MALLOC_CAP_8BIT);
  if (new_size <= SMALL) {
    void* q = multi_heap_realloc(s_chunk[i].heap, p, new_size);
    if (q) return q;
  }
  size_t old = multi_heap_get_allocated_size(s_chunk[i].heap, p);  // before anything is freed
  void* q = lv_malloc_core(new_size);
  if (!q) return NULL;
  memcpy(q, p, old < new_size ? old : new_size);
  lv_free_core(p);
  return q;
}

void lv_mem_monitor_core(lv_mem_monitor_t* mon_p) { LV_UNUSED(mon_p); }
lv_result_t lv_mem_test_core(void) { return LV_RESULT_OK; }

#endif
