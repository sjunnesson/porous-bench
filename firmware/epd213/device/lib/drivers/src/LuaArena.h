// Lua's own heap: one block carved out at boot, so apps can't take the memory
// Wi-Fi and TLS need to stay connected. (The same arena as
// firmware/c6-lcd147's, where it was found and measured.)
//
// Without PSRAM, Lua and the network share the ESP32's internal heap, ~70 KB
// of it once Wi-Fi and TLS are up. Resident's allocator gives Lua whatever is
// free: an app that grows, or just scatters small blocks until no 16 KB piece
// is left, leaves TLS unable to allocate, the WebSocket drops, and the board
// can't even be sent the next app. Capping Lua's share of free bytes isn't
// enough on its own, because the fragmentation is the problem.
//
// reserve() takes one contiguous block before Wi-Fi starts and makes it a heap
// of its own (multi_heap_register); registerModule() points the sandbox's one
// Lua state at it (lua_setallocf). An app that outgrows the arena gets "not
// enough memory" in its own dispatch, after Lua's emergency collection, and
// the rest of the heap stays whole for the network. Blocks Lua allocated
// before the switch (the state and its libraries) stay where they are until
// freed, or move in when they grow. On a board with PSRAM, reserve() does
// nothing: Resident already puts Lua there.
//
// It registers no Lua functions, so apps see no `memory` global.
#pragma once
#include <cstring>
#include <ResidentDriver.h>
#include <ResidentLuaModule.h>
#include <esp_heap_caps.h>
#include <multi_heap.h>

extern "C" {
  #include "lua/lua.h"
}

class LuaArena : public Resident::Driver {
public:
  explicit LuaArena(size_t bytes) : _bytes(bytes) {}

  // Call from setup() before Wi-Fi, while the heap is still in one piece.
  bool reserve() {
    if (heap_caps_get_total_size(MALLOC_CAP_SPIRAM) > 0) return false;
    _start = static_cast<uint8_t*>(heap_caps_malloc(_bytes, MALLOC_CAP_8BIT));
    if (_start) _heap = multi_heap_register(_start, _bytes);
    return _heap != nullptr;
  }

  const char* name() const override { return "memory"; }
  void registerModule(Resident::LuaModule& m) override {
    if (!_heap) return;
    lua_State* L = m.state();
    _before = (size_t)lua_gc(L, LUA_GCCOUNT, 0) * 1024 + lua_gc(L, LUA_GCCOUNTB, 0);
    lua_setallocf(L, alloc, this);
  }

  // What Lua held in the shared heap when the arena took over: the state,
  // its standard libraries and the modules registered before this one.
  size_t before() const { return _before; }

  size_t size() const { return _bytes; }
  size_t freeBytes() const { return _heap ? multi_heap_free_size(_heap) : 0; }
  size_t lowestFree() const { return _heap ? multi_heap_minimum_free_size(_heap) : 0; }
  size_t largestFree() const {
    if (!_heap) return 0;
    multi_heap_info_t info;
    multi_heap_get_info(_heap, &info);
    return info.largest_free_block;
  }

private:
  bool owns(void* p) const { return p >= _start && p < _start + _bytes; }

  // lua_Alloc. Lua runs on the loop task only, so the arena needs no lock.
  static void* alloc(void* ud, void* ptr, size_t osize, size_t nsize) {
    auto* a = static_cast<LuaArena*>(ud);
    if (nsize == 0) {
      if (ptr && a->owns(ptr)) multi_heap_free(a->_heap, ptr);
      else if (ptr) heap_caps_free(ptr);
      return nullptr;
    }
    if (ptr == nullptr || a->owns(ptr)) {
      // For a new block osize is a type tag, not a size. Shrinking in place
      // never fails, as Lua requires.
      return ptr ? multi_heap_realloc(a->_heap, ptr, nsize) : multi_heap_malloc(a->_heap, nsize);
    }
    // A block from before the switch: move it into the arena. If the arena is
    // full and Lua is only shrinking it, keep the old block (Lua must not see
    // a shrink fail).
    void* p = multi_heap_malloc(a->_heap, nsize);
    if (!p) return nsize <= osize ? ptr : nullptr;
    memcpy(p, ptr, osize < nsize ? osize : nsize);
    heap_caps_free(ptr);
    return p;
  }

  size_t _bytes;
  size_t _before = 0;
  uint8_t* _start = nullptr;
  multi_heap_handle_t _heap = nullptr;
};
