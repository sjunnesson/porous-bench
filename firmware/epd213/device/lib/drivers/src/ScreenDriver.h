// `screen`: the M5Stick drawing verbs over the shared 1-bit frame, plus the
// board's status display (connection text and the device ID) and its one
// screen, "main": 122x250, depth 1, light scheme (e-paper).
//
// Colours are 0-255 channels as on the M5Stick; each pixel becomes black or
// white by luminance (>= 50 % is white). flip() queues the frame; the panel
// refreshes in the background (partial ~0.2 s, every 10th full ~1.9 s), so
// apps should flip only when something changed.
#pragma once
#include <ResidentLuaModule.h>
#include <ResidentSystemDisplay.h>

class ScreenDriver : public Resident::SystemDisplay {
public:
  const char* name() const override { return "screen"; }

  void registerModule(Resident::LuaModule& m) override {
    m.method<ScreenDriver, &ScreenDriver::clear>("clear")
     .method<ScreenDriver, &ScreenDriver::text>("text")
     .method<ScreenDriver, &ScreenDriver::fillRect>("fill_rect")
     .method<ScreenDriver, &ScreenDriver::rect>("rect")
     .method<ScreenDriver, &ScreenDriver::line>("line")
     .method<ScreenDriver, &ScreenDriver::triangle>("triangle")
     .method<ScreenDriver, &ScreenDriver::fillTriangle>("fill_triangle")
     .method<ScreenDriver, &ScreenDriver::pixel>("pixel")
     .method<ScreenDriver, &ScreenDriver::qr>("qr")
     .method<ScreenDriver, &ScreenDriver::flip>("flip")
     .method<ScreenDriver, &ScreenDriver::setBrightness>("set_brightness")
     .method<ScreenDriver, &ScreenDriver::width>("width")
     .method<ScreenDriver, &ScreenDriver::height>("height");
  }

  void update() override;
  void onAppReset() override;
  void onAppRunning(bool running) override { _appRunning = running; }

  // Resident::SystemDisplay: status text, drawn only while no app runs.
  void displayText(const char* text) override;

  // Resident::DisplayDriver: the one screen.
  int screenCount() const override { return 1; }
  Resident::Screen screen(int i) const override;
  void getScreen(int i, lua_State* L) override;
  bool refresh(int i) override;

private:
  bool _appRunning = false;

  int clear(lua_State* L);
  int text(lua_State* L);
  int fillRect(lua_State* L);
  int rect(lua_State* L);
  int line(lua_State* L);
  int triangle(lua_State* L);
  int fillTriangle(lua_State* L);
  int pixel(lua_State* L);
  int qr(lua_State* L);
  int flip(lua_State* L);
  int setBrightness(lua_State* L);
  int width(lua_State* L);
  int height(lua_State* L);
};
