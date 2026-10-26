# Build fixes for Resident's libraries on Arduino core 3.x (pioarduino), shared
# by the stage projects as `extra_scripts = pre:../core3.py`, and a project's
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
    # Its C++ wrapper (Lua.h, unused by Resident but compiled with the
    # library) names std::string without including <string>; core 2.x headers
    # happened to pull it in, 3.x's don't.
    cxx = ["-include", "string"] if lua and path.endswith(".cpp") else []
    if not OPTIMIZE and not cxx:
        return node
    return env.Object(node, CCFLAGS=env["CCFLAGS"] + OPTIMIZE, CXXFLAGS=env["CXXFLAGS"] + cxx)


env.AddBuildMiddleware(_sources)
