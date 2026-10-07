// What the drivers need to know about the board, as build flags with the
// Waveshare ESP32 e-Paper Driver Board (and its V2 panel) as the defaults:
//
//   -DEPD_PANEL=4                  panel generation: 2 (IL3897) or 4 (SSD1680)
//   -DEPD_DIN=11 -DEPD_CLK=12 -DEPD_CS=10 -DEPD_DC=13 -DEPD_RST=14 -DEPD_BUSY=9
//   -DBUTTON_A=0 -DBUTTON_B=4      keys to GND (internal pull-up); -1 = none
#pragma once

#ifndef EPD_PANEL
#define EPD_PANEL 2
#endif
#ifndef EPD_DIN
#define EPD_DIN 14
#endif
#ifndef EPD_CLK
#define EPD_CLK 13
#endif
#ifndef EPD_CS
#define EPD_CS 15
#endif
#ifndef EPD_DC
#define EPD_DC 27
#endif
#ifndef EPD_RST
#define EPD_RST 26
#endif
#ifndef EPD_BUSY
#define EPD_BUSY 25
#endif
#ifndef BUTTON_A
#define BUTTON_A 12   // the driver board's IO12 key
#endif
#ifndef BUTTON_B
#define BUTTON_B -1
#endif

#if EPD_PANEL == 4
#define EPD_MODEL "Waveshare 2.13\" e-Paper (V4)"
#define EPD_CONTROLLER "SSD1680"
#else
#define EPD_MODEL "Waveshare 2.13\" e-Paper (V2, HINK-E0213A22)"
#define EPD_CONTROLLER "IL3897"
#endif
