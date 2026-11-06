// The Guition ESP32-S3-4848S040's 4" 480x480 ST7701S panel, shared by all
// three stages. The panel has no frame memory of its own: after an init
// sequence over 3-wire SPI, the ESP32-S3's LCD peripheral scans a frame buffer
// in PSRAM out to it over a 16-bit RGB bus, continuously, at a 12 MHz pixel
// clock (~42 frames a second with the porches). Stages 1 and 2 draw by copying
// pixels into that buffer (drawRows() and drawRect()); stage 3 asks for three
// frames, draws straight into one that isn't on the glass and has it shown
// from the next vertical sync (frames(), show()).
//
// No Resident headers here: stage 1 builds without Resident.
#pragma once
#include <Arduino.h>

namespace RgbPanel {

constexpr int WIDTH = 480, HEIGHT = 480;

// ST7701S init, then the RGB scan (its frame buffer in PSRAM, black), then the
// backlight on. False if the scan didn't start. `frames` (IDF 5 and later): how many
// frame buffers the driver keeps, 1 to 3, for frames() and show() below.
bool begin(int frames = 1);

// The driver's frames, all black to start with; the first is the one on the glass. Returns how many
// (0 before IDF 5). Draw into one that isn't inUse(), then show() it: it's scanned from the next
// vertical sync on, and nothing is copied. A frame is in use while it's on the glass or about to be.
// Nothing here turns the picture: pixels go where the panel scans them (see setRotation).
int frames(uint16_t** out, int max);
void show(const uint16_t* frame);
bool inUse(const uint16_t* frame);

// Copy the rectangle x0..x1, y0..y1 (inclusive) of a 480x480 RGB565 image, in
// the chip's own byte order, into the frame the panel is scanned from, turned
// as setRotation() says. `img` is the whole image: start it on 64 bytes, so a
// turned copy's 32-byte reads are one cache line each.
void drawRect(const uint16_t* img, int x0, int y0, int x1, int y1);
// Rows y0..y1 of it, `rows` pointing at row y0.
void drawRows(const uint16_t* rows, int y0, int y1);
// Between these, the frame is written back from the cache once, at endBatch(),
// instead of after every rectangle: for a push of many small ones.
void beginBatch();
void endBatch();

// Turn the picture on the glass: 0, 90, 180 or 270 degrees clockwise, as
// ESPHome counts them (at 0 the USB-C is on the right; 270 puts it at the
// bottom). The panel is square, so the image stays 480x480. Turned rows are
// written straight into the frame, or through a 15 KB strip in internal RAM if
// begin() didn't find it; false (and not turned) if that couldn't be allocated.
bool setRotation(int degrees);
int rotation();
// A point on the panel (where the touch panel reports it) to the same point
// in the image.
void toImage(int& x, int& y);

#ifdef BENCH_PROFILE
// A vertical sync whose frame didn't get its 48 bounce buffers refilled, and which way the driver's
// count now stands: odd, it refills the buffer being sent rather than the one just sent.
struct ScanEvent { uint32_t ms; uint16_t got; uint16_t odd; };
uint32_t scanEvents();
bool scanEvent(uint32_t i, ScanEvent& out);
#endif

// Tear the scan down and start it again, on a new (black) frame buffer: the
// caller pushes its frame again after. Stage 1's RESTART: for a picture that
// slipped and stayed slipped, which a flash write hasn't done on this board
// (see the README).
bool restart();

// Whether turned pushes write the frame straight, or through draw_bitmap
// because the frame buffer couldn't be found.
bool writesDirect();

void setBacklight(float v);  // 0..1, PWM on GPIO38
float backlight();

uint32_t scans();  // frames scanned out since begin(), counted by interrupt

}  // namespace RgbPanel
