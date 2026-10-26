// The Guition ESP32-S3-4848S040's 4" 480x480 ST7701S panel, shared by all
// three stages. The panel has no frame memory of its own: after an init
// sequence over 3-wire SPI, the ESP32-S3's LCD peripheral scans a frame buffer
// in PSRAM out to it over a 16-bit RGB bus, continuously, at a 12 MHz pixel
// clock (~42 frames a second with the porches). Drawing is copying pixels into
// that buffer: drawRows() copies rows into it and writes the cache back, so the
// next scan shows them.
//
// No Resident headers here: stage 1 builds without Resident.
#pragma once
#include <Arduino.h>

namespace RgbPanel {

constexpr int WIDTH = 480, HEIGHT = 480;

// ST7701S init, then the RGB scan (its frame buffer in PSRAM, black), then the
// backlight on. False if the scan didn't start.
bool begin();

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
