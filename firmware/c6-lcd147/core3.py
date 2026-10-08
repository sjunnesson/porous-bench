# Build fixes for Resident's libraries on Arduino core 3.x (pioarduino), shared
# by the stage projects as `extra_scripts = pre:../core3.py`. Both touch only
# Esp32Lua's files: a rebuilt core (device-lean) compiles ESP-IDF with this
# environment too, and a global flag would reach it.
Import("env")


def _esp32lua(env, node):
    path = node.get_path().replace("\\", "/")
    if "/Esp32Lua/" not in path:
        return node
    # Esp32Lua carries Lua's standalone interpreter and compiler (lua.c,
    # luac.c), each with its own main(). Core 2.x linked libraries as
    # archives, so nothing pulled them in; pioarduino links library objects
    # directly and the two main()s collide. Leave them out.
    if path.endswith(("/lua/lua.c", "/lua/luac.c")):
        return None
    # Its C++ wrapper (Lua.h, unused by Resident but compiled with the
    # library) names std::string without including <string>; core 2.x headers
    # happened to pull it in, 3.x's don't.
    if path.endswith(".cpp"):
        return env.Object(node, CXXFLAGS=env["CXXFLAGS"] + ["-include", "string"])
    return node


env.AddBuildMiddleware(_esp32lua)
