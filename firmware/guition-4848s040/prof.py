#!/usr/bin/env python3
"""Names the addresses device/lib/drivers/src/Profiler.h prints.

  prof.py <firmware.elf> <serial log> [nth profile from the end, default 1]

Prints the share of samples by library and by function. Needs the toolchain's nm and addr2line
(~/.platformio/packages/toolchain-xtensa-esp-elf/bin) and, for the ROM's names, tool-esp-rom-elfs.
"""
import bisect, collections, glob, os, re, subprocess, sys

elf, log = sys.argv[1], sys.argv[2]
nth = int(sys.argv[3]) if len(sys.argv) > 3 else 1
tools = os.path.expanduser("~/.platformio/packages/toolchain-xtensa-esp-elf/bin/xtensa-esp32s3-elf-")

runs, cur, depth = [], None, 1
for line in open(log, "rb"):
    t = line.decode("latin1").split(" ", 1)[-1].strip()
    if t.startswith("[prof] begin"):
        cur, m = [], re.search(r"x (\d+)", t)
        depth = int(m.group(1)) if m else 1
    elif t.startswith("[prof] end"):
        if cur is not None: runs.append((cur, depth))
        cur = None
    elif cur is not None:
        cur += [int(x, 16) for x in re.findall(r"\b[0-9a-f]{8}\b", t)]
words, depth = runs[-nth]
stacks = [words[i:i + depth] for i in range(0, len(words) - depth + 1, depth)]
pcs = [s[0] for s in stacks]

syms = []
for l in subprocess.run([tools + "nm", "-S", "-n", "--defined-only", elf], capture_output=True, text=True).stdout.splitlines():
    p = l.split()
    if len(p) == 4 and p[2] in "tTwW": syms.append((int(p[0], 16), int(p[1], 16), p[3]))
# The ROM's functions (memcpy, the cache calls...) are named in the chip's ROM ELF, which PlatformIO has.
rom = glob.glob(os.path.expanduser("~/.platformio/packages/tool-esp-rom-elfs/esp32s3_rev0_rom.elf"))
if rom:
    for l in subprocess.run([tools + "nm", "-S", "-n", "--defined-only", rom[0]], capture_output=True, text=True).stdout.splitlines():
        p = l.split()
        if len(p) == 4 and p[2] in "tTwW": syms.append((int(p[0], 16), int(p[1], 16), "ROM " + p[3]))
syms.sort()
starts = [s[0] for s in syms]

def name(pc):
    i = bisect.bisect_right(starts, pc) - 1
    if i >= 0 and pc < syms[i][0] + max(syms[i][1], 1): return syms[i][2]
    if 0x40000000 <= pc < 0x40060000: return "(ROM)"
    return "(unknown %08x)" % pc

uniq = sorted(set(pcs))
out = subprocess.run([tools + "addr2line", "-e", elf] + ["%x" % p for p in uniq], capture_output=True, text=True).stdout.splitlines()
where = dict(zip(uniq, out))

def lib(pc):
    f = where.get(pc, "?")
    for key, label in (("/lvgl/", "LVGL"), ("/luavgl/", "luavgl"), ("/Esp32Lua/", "Lua"), ("/resident/", "Resident"),
                       ("/lib/drivers/", "drivers (canvas, push)"), ("/lib/panel/", "panel"), ("Adafruit", "Adafruit GFX"),
                       ("/esp_lcd/", "esp_lcd"), ("/freertos/", "FreeRTOS"), ("/heap/", "heap"), ("/newlib/", "libc"),
                       ("/esp_wifi/", "Wi-Fi"), ("/lwip/", "lwIP"), ("/mbedtls/", "mbedTLS")):
        if key in f: return label
    n = name(pc)
    if n.startswith("ROM ") or n == "(ROM)": return "ROM (memcpy, memset, cache)"
    if n in ("esp_cpu_wait_for_intr", "prvIdleTask", "vApplicationIdleHook") or "idle" in n.lower(): return "idle"
    m = re.search(r"/components/([^/]+)/", f)
    return m.group(1) if m else "other"

n = len(pcs)
libs, funcs = collections.Counter(lib(p) for p in pcs), collections.Counter(name(p) for p in pcs)
ram = sum(1 for p in pcs if 0x40370000 <= p < 0x403e0000)
print(f"{n} samples; {100 * ram / n:.0f}% in IRAM, {100 * sum(1 for p in pcs if 0x42000000 <= p < 0x44000000) / n:.0f}% in flash")
print("\nby library")
for k, v in libs.most_common(14): print(f"  {100 * v / n:5.1f}%  {k}")
print("\nby function")
for k, v in funcs.most_common(int(os.environ.get("TOP", 30))): print(f"  {100 * v / n:5.1f}%  {k}")
if depth > 1:
    # Whose time a helper's is: the nearest caller that isn't itself a helper.
    helpers = re.compile(r"^(ROM |vPortExitCritical|vPortEnterCritical|xPort|vPort|multi_heap|heap_caps|tlsf_|lv_m(alloc|emcpy|emset|em)|lv_free|lv_realloc|lv_draw_buf|esp_timer|systimer|micros|millis|lv_tick|trace_|lv_style_get_prop|get_prop_core|get_selector_style_prop|lv_obj_get_style_prop|lv_style_prop_get_default|lv_obj_style_apply_recolor|luaH_|luaV_|luaD_|luaM_|luaC_|luaS_|luaT_|luaO_|lua_|luaL_|l_alloc|psramLuaAlloc|lv_event_|event_send_core|lv_obj_event_base|lv_obj_send_event|lv_area_|lv_ll_)")
    owner = collections.Counter()
    for st in stacks:
        names = [name(p) for p in st if p]
        own = next((x for x in names if not helpers.match(x)), names[-1] if names else "?")
        owner[own] += 1
    print("\nby the function it was for (helpers such as memcpy, locks, style lookups and Lua's VM go to their caller)")
    for k, v in owner.most_common(int(os.environ.get("TOP", 30))): print(f"  {100 * v / n:5.1f}%  {k}")
    for target in os.environ.get("WHO", "ROM _xtos_set_intlevel,ROM memcpy").split(","):
        c = collections.Counter(" <- ".join(name(p) for p in st[1:] if p) for st in stacks if name(st[0]) == target)
        tot = sum(c.values())
        if tot:
            print(f"\ncallers of {target} ({100 * tot / n:.1f}%)")
            for k, v in c.most_common(8): print(f"  {100 * v / n:5.1f}%  {k}")
