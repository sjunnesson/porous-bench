# Third-party notices

These files are copied from [inanimate-tech/resident](https://github.com/inanimate-tech/resident) (commit 8e4a130) and used under its MIT License:

- `src/resident/lua/datetime.lua` (from `src/ResidentDatetime.h`)
- `src/resident-apps/accel.lua`, `bounce.lua`, `buttons-buzzer.lua`, `daisy.lua`, `hello.lua`, `rainbow.lua`, `water-sim.lua` (from `examples/m5stick-demo/device-apps/`)
- `src/resident-apps/swiss-clock.lua` (from `examples/m5stick-clock/device-apps/`)

`src/resident/timecore.ts` is a TypeScript port of `src/ResidentTimeCore.h`, and `src/sim/devices/waveshare-esp32-c6-lcd-1.47.ts` carries the panel init values from Waveshare's ESP32-C6-LCD-1.47 demo.

```
MIT License

Copyright (c) 2026 Inanimate (https://inanimate.tech)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## LVGL and luavgl

`src/resident/lua/lvgl.lua` and `src/resident/lvgl.ts` reimplement, without copying source, the Lua API of
[luavgl](https://github.com/inanimate-tech/luavgl) (MIT) and follow [LVGL](https://github.com/lvgl/lvgl) (MIT)
for its constants, default-theme values and animation paths (the `overshoot` and `bounce` curves use the
control points from LVGL's `lv_anim.c`).

## Montserrat

The Montserrat font (via `@fontsource/montserrat`) is bundled into the build to draw LVGL text. Copyright 2011
The Montserrat Project Authors, licensed under the [SIL Open Font License 1.1](https://openfontlicense.org).
