# Build fixes for Resident's libraries on Arduino core 3.x (pioarduino), shared
# by every board's projects on it as `extra_scripts = pre:../../core3.py`, and a project's
# `custom_optimize` (device/: -O2). All of it goes on single source files, not
# the environment: a rebuilt core (device/) compiles ESP-IDF in this
# environment too, and a global flag would reach it.
Import("env")

# The flags go last, after the core's -Os, so they win. A global -O2 broke the
# core rebuild: ESP-IDF's newlib compiles memcpy.c and its kin with an -O2 of
# their own and stops on -Os (`#error ... DIG-694`); pioarduino adds a file's
# flags only where the environment doesn't have them yet, so with -O2 already
# there the file kept only the core's -Os, which comes after it.
OPTIMIZE = env.GetProjectOption("custom_optimize", "").split()


def _sources(env, node):
    # pioarduino's core rebuild (device/): leave its stand-in sources as they
    # are, for ESP-IDF's own middleware to drop.
    if env.subst("$ARDUINO_LIB_COMPILE_FLAG") == "Build":
        return node
    path = node.get_path().replace("\\", "/")
    lua = "/Esp32Lua/" in path
    # Esp32Lua carries Lua's standalone interpreter and compiler (lua.c,
    # luac.c), each with its own main(). Core 2.x linked libraries as
    # archives, so nothing pulled them in; pioarduino links library objects
    # directly and the two main()s collide. Leave them out.
    if lua and path.endswith(("/lua/lua.c", "/lua/luac.c")):
        return None
    # LVGL's blending in ARM assembly (Helium, NEON): nothing on an ESP32, but each still goes
    # through the C preprocessor, and IDF 6's newlib headers no longer hide from assembly.
    if "/lvgl/" in path and path.endswith(".S") and ("/helium/" in path or "/neon/" in path):
        return None
    # Its C++ wrapper (Lua.h, unused by Resident but compiled with the
    # library) names std::string without including <string>; core 2.x headers
    # happened to pull it in, 3.x's don't.
    cxx = ["-include", "string"] if lua and path.endswith(".cpp") else []
    # The LVGL that luavgl tracks passes a comparison function of the wrong
    # pointer type (lv_obj_property.c): GCC 12 (core 2.x) warned, GCC 14 stops.
    # It's harmless where it's used, so on LVGL's own C files it stays a warning.
    c = ["-Wno-error=incompatible-pointer-types"] if "/lvgl/" in path and path.endswith(".c") else []
    # QRCode (screen.qr) declares a bool of its own, which C23, the default from GCC 15 (core 4.x),
    # makes a keyword: its C is C17.
    if "/QRCode/" in path and path.endswith(".c"):
        c = c + ["-std=gnu17"]
    if not OPTIMIZE and not cxx and not c:
        return node
    return env.Object(node, CCFLAGS=env["CCFLAGS"] + OPTIMIZE, CXXFLAGS=env["CXXFLAGS"] + cxx, CFLAGS=env["CFLAGS"] + c)


env.AddBuildMiddleware(_sources)


# The LVGL commit luavgl tracks declares property_name_compare as returning
# int32_t and defines it returning int (lv_obj_property.c). With IDF 4.4 those
# were the same type; IDF 5 made int32_t a long on the Xtensa chips (the S3),
# and the two conflict. lv_utils_bsearch takes an int comparator, so the
# declaration is the one to fix, in the copy the project downloaded.
def _patch_lvgl():
    path = env.subst("$PROJECT_LIBDEPS_DIR/$PIOENV/lvgl/src/core/lv_obj_property.c")
    try:
        with open(path) as f:
            src = f.read()
    except OSError:
        return  # no LVGL in this project
    wrong = "static int32_t property_name_compare(const void * ref, const void * element);"
    if wrong in src:
        with open(path, "w") as f:
            f.write(src.replace(wrong, wrong.replace("int32_t", "int", 1)))


_patch_lvgl()
