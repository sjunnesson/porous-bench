// A prompt for Claude Code to build Resident firmware for the hardware selected on Bench and flash it,
// so the real device comes online on the relay with a device ID that Bench's Real device panel can
// mirror to. Grounded in Resident's own guide (docs/start-building.md) and Bench's profile of the part.

import type { Board } from '../sim/boards';
import type { DeviceProfile } from '../sim/devices/types';

const RESIDENT = 'https://github.com/inanimate-tech/resident';
const START_BUILDING = 'https://raw.githubusercontent.com/inanimate-tech/resident/main/docs/start-building.md';
const DEVICE_SKILL = 'https://raw.githubusercontent.com/sjunnesson/porous-bench/main/docs/resident/DEVICE-SKILL.md';
const SITE = 'https://bench.porous.systems';

/** Official Resident firmware for these boards: build it as it is. */
const M5_ENVS: Record<string, string> = { 'm5stickc-plus2': 'm5stick', m5sticks3: 'm5sticks3' };

const REPO = 'https://github.com/sjunnesson/porous-bench';

/** Firmware Bench ships in its own repo (firmware/), by output and board: build it as it is. */
const BENCH_FIRMWARE: Record<string, { path: string; tested: boolean; note?: string }> = {
  'waveshare-epd-2.13-v4|waveshare-esp32-epaper-driver': {
    path: 'firmware/epd213/device',
    tested: true,
    note: 'Its panel may be the older V2 (ribbon HINK-E0213A22, controller IL3897): that build drives the V2, which is what the driver boards Bench has seen carry. If partial refreshes flash the whole screen, the panel is the other generation: rebuild with `-DEPD_PANEL=4`.',
  },
  'waveshare-epd-2.13-v4|esp32-s3-devkitc-1-n16r8': {
    path: 'firmware/epd213/device-s3',
    tested: false,
    note: 'It compiles but hasn\'t run on hardware yet: wire it as its README says and go through its first-flash checklist with me (PSRAM reported, orientation, partial refreshes in place, BOOT taps).',
  },
};

/** What bringing up Resident on real boards has taught, for hardware without firmware yet. */
const DISPLAY_LESSONS = [
  '- `flip()` must not wait for a slow panel: Resident aborts a Lua dispatch after 1 s. Snapshot the frame, return, and refresh from the driver\'s `update()`; for e-paper, one refresh at a time, newest frame wins, skip a frame identical to the one on the glass.',
  '- On a 1-bit panel, give the `lgfx` module a `Resident::LgfxTarget` that draws into the same 1-bit canvas as `screen` (luminance >= 50% is white) instead of a full RGB565 sprite.',
];
const LESSONS = [
  '- Check the real part against Bench\'s profile before trusting it: read the ribbon or the back sticker (a "2.13 V4" may turn out to be a V2 with another controller). A test card that looks right can hide the wrong controller; partial refresh is what tells them apart.',
  '- Measure app memory with `heap_caps_get_free_size(MALLOC_CAP_8BIT)` and `heap_caps_get_largest_free_block(MALLOC_CAP_8BIT)`, not `ESP.getFreeHeap()`: on a classic ESP32 that also counts IRAM Lua can\'t use. Without PSRAM about 70 KB is left once Wi-Fi and TLS are up; LVGL\'s first bind keeps ~30 KB, so leave `lvgl` out there.',
  '- Opening the serial port resets a board with a USB-serial bridge (DTR/RTS); open it with both lines released, or it can stay held in reset.',
  '- A key on a strapping pin (IO12 on the Waveshare e-Paper Driver Board) may have no pull-up of its own: enable `INPUT_PULLUP` after boot.',
  `- When it works, tell me the libraries it has and the app memory you measured, so Bench's board entry (src/sim/boards.ts in ${REPO}) lists the right apps for it.`,
];

const pins = (w: Record<string, number>) =>
  Object.entries(w)
    .map(([k, v]) => `${k} ${v}`)
    .join(', ');

/** The board chosen in Bench for a bare module or an LED chain, still to be confirmed. */
function chosenBoard(board: Board, what: string): string {
  return `- **Board:** a ${board.name}, my choice in Bench (${board.note}). Confirm it with me, and ask ${what} before writing code.`;
}

function hardwareSection(p: DeviceProfile, board?: Board): string[] {
  const lines: string[] = [];
  const leds = p.look.leds;
  if (leds) {
    const n = p.width * p.height;
    const shape = leds.layout === 'grid' ? `a ${p.width}×${p.height} matrix, wired row by row from the top left` : leds.layout === 'ring' ? `a ring of ${n}` : `a strip of ${n}`;
    lines.push(
      `- **Output:** WS2812B addressable LEDs, ${shape} (${n} LEDs, 800 kHz one-wire, GRB). Bench assumes data in on **GPIO ${p.wiring?.DIN ?? 18}** of an ESP32 board.`,
      board ? chosenBoard(board, 'which pin the data line is on') : '- **Board:** any ESP32 dev board. Ask me which one I have (and which pin the data line is on) before writing code.',
    );
  } else {
    const turned = (p.firmwareRotation ?? 0) % 2 === 1;
    lines.push(
      `- **Display:** ${p.name}: ${p.width}×${p.height} ${p.tech.toUpperCase()} (${turned ? `apps see it as ${p.height}×${p.width}, rotation ${p.firmwareRotation}` : 'apps see it as is'}), ${p.controller} over ${p.bus.kind.toUpperCase()} at ${p.bus.hz >= 1e6 ? `${p.bus.hz / 1e6} MHz` : `${p.bus.hz / 1e3} kHz`}${p.bus.i2cAddress ? `, address 0x${p.bus.i2cAddress.toString(16)}` : ''}.`,
    );
    if (p.ram) lines.push(`- **Controller RAM:** ${p.ram.width}×${p.ram.height}; the visible area starts at x+${p.ram.offsetX}, y+${p.ram.offsetY}.`);
    if (p.wiring) lines.push(`- **Wiring (GPIO):** ${pins(p.wiring)}.`);
    else {
      const part = p.enclosure?.parts?.find((x) => x.kind === 'header');
      const header = part?.kind === 'header' ? part.label : undefined;
      lines.push(
        board
          ? `- **Module:** a bare display module${header ? ` (pins: ${header})` : ''}.`
          : `- **Board:** this is a bare display module${header ? ` (pins: ${header})` : ''}, wired to an ESP32 board. Ask me which board I have and how it's wired before writing code.`,
      );
      if (board) lines.push(chosenBoard(board, "how it's wired"));
    }
  }
  const buttons = (p.enclosure?.parts ?? []).flatMap((x) => (x.kind === 'button' && x.input !== undefined ? [{ label: x.label ?? 'button', input: x.input }] : []));
  if (buttons.length) lines.push(`- **Buttons:** ${buttons.map((b) => `${b.label} = button ${'AB'[b.input] ?? b.input} (index ${b.input})`).join(', ')}.`);
  if (p.builtins?.length) lines.push(`- **Also on the board:** ${p.builtins.map((b) => (b === 'imu' ? 'an IMU' : 'a buzzer')).join(' and ')}.`);
  for (const note of p.porting ?? []) lines.push(`- ${note}`);
  if (p.url) lines.push(`- Datasheet / docs: ${p.url}`);
  return lines;
}

function planSection(p: DeviceProfile, board?: Board): string[] {
  const shipped = board && BENCH_FIRMWARE[`${p.id}|${board.id}`];
  if (shipped) {
    return [
      `Bench ships firmware for this display on this board: \`${shipped.path}\` in ${REPO} (its README has the wiring, the pins and what was learnt bringing it up). It pulls Resident from GitHub, pinned to the commit it was ${shipped.tested ? 'tested on hardware' : 'built'} against.`,
      `1. Clone ${REPO} and build \`${shipped.path}\` as it is (\`pio run\`).`,
      '2. Find the board\'s port (`pio device list`), confirm it with me, then flash: `pio run -t upload`.',
      ...(shipped.note ? [`3. ${shipped.note}`, '4. Go to step "First boot" below.'] : ['3. Go to step "First boot" below.']),
    ];
  }
  const env = M5_ENVS[p.id];
  if (env) {
    return [
      `Resident ships working firmware for this board: \`examples/m5stick-demo/device\` in ${RESIDENT}, PlatformIO env \`${env}\`${env === 'm5stick' ? ' (or `m5stick-lvgl` for the optional lvgl module)' : ''}.`,
      '1. Clone the Resident repo and build that example as it is (it links Resident from the repo itself).',
      '2. Find the board\'s port (`pio device list`), confirm with me, then flash: `pio run -e ' + env + ' -t upload`.',
      '3. Go to step "First boot" below.',
    ];
  }
  const c6 = /esp32-c6/i.test(p.id);
  const lines = [
    `Follow Resident's guide for new hardware, written for coding agents: ${START_BUILDING}. It has three flashable stages; do them in order and check each with me on the real board before the next:`,
    '1. **Bring-up, no Resident:** the smallest PlatformIO project that boots, prints chip info over serial and ' +
      (p.look.leds ? 'runs a rainbow across every LED (check the count and the colour order).' : 'draws a test card that proves orientation, offsets and colours (red, green, blue bars, a 1 px border on the visible edge).'),
    '2. **Add Resident:** Wi-Fi through WiFiManager\'s captive portal, the WebSocket to `resident.inanimate.tech` at `/devices/<deviceId>` (the guide\'s `onTransportsWillConnect` override), and a status screen showing WiFi → Connecting → Connected → the **device ID**.',
    '3. **Add drivers** (one `Resident::Driver` each, in `lib/drivers/`) so Bench\'s apps run unchanged. Bench\'s device skill is the surface to match: ' +
      DEVICE_SKILL +
      (p.look.leds
        ? '. Implement its `leds` module exactly (`count`, `width`, `height`, `xy`, `set`, `set_rgb`, `get`, `fill`, `clear`, `hsv`, `brightness`, `show`, and `on_frame(fn, fps)` as a frame timer calling the app between ticks; if Resident can\'t call into Lua from a driver timer, say so and document `on_tick` as the fallback).'
        : '. Start with `screen` (the M5Stick drawing calls) on a full-frame canvas pushed in one transfer by `flip()`, then the board\'s buttons as `tap` / `hold` events, then `lgfx` (the LovyanGFX-style calls Bench apps use). ' +
          (p.touch
            ? `Then the ${p.touch.controller} touch panel as Bench's \`touchscreen\` module: \`read()\` returning \`{ pressed, x, y }\` in the coordinates apps draw in, and \`touch_down\` / \`touch_move\` (at most one per loop) / \`touch_up\` / \`touch_tap\` driver events with \`{ x, y }\` (a tap: released within 500 ms, moved under 10 px). `
            : '') +
          lvglAdvice(board)),
    '',
    'Practicalities:',
    '- Install PlatformIO if it\'s missing (`brew install platformio` or `pipx install platformio`). Put the project in a new folder here, and clone Resident next to it for the `symlink://` lib_dep, as its examples do.',
    '- Resident builds as C++17 (`build_unflags = -std=gnu++11`, `build_flags = -std=gnu++17`), and its firmware is about 1.2 MB: give it a custom `partitions.csv` with a big enough app slot.',
  ];
  if (c6) {
    lines.push(
      '- **ESP32-C6:** the `espressif32@6.x` platform in Resident\'s examples is too old for the C6. Use pioarduino (Arduino core 3.x): `platform = https://github.com/pioarduino/platform-espressif32/releases/download/stable/platform-espressif32.zip`, board `esp32-c6-devkitc-1`.',
      '- The C6 has 512 KB of RAM and this board, as far as I know, no PSRAM: check the canvas (172×320×2 bytes ≈ 110 KB) still leaves Wi-Fi and Lua enough room. No one has published Resident on a C6 yet, so expect bring-up work and tell me what you find.',
      '- It has native USB: add `-DARDUINO_USB_MODE=1 -DARDUINO_USB_CDC_ON_BOOT=1` or serial stays silent. If the port doesn\'t show up, I hold BOOT while plugging it in.',
    );
  }
  lines.push('- Flashing replaces whatever is on the board: confirm the port with me before the first upload.');
  lines.push('', 'Lessons from boards Bench has already brought up:', ...(p.look.leds ? [] : DISPLAY_LESSONS), ...LESSONS);
  return lines;
}

function lvglAdvice(board?: Board): string {
  if (!board || board.appRamKb === undefined) return 'The `lvgl` module (luavgl) is optional: only if memory allows.';
  return board.libraries.includes('lvgl')
    ? `Then \`lvgl\` (luavgl, as Resident's \`m5stick-lvgl\` env does it): Bench lists LVGL apps for this board.`
    : 'Skip `lvgl`: this board has no PSRAM and LVGL doesn\'t fit next to Wi-Fi and TLS; Bench lists only `screen` and `lgfx` apps for it.';
}

/** The firmware prompt, as Markdown. `board`: the board chosen in Bench for a bare module or LEDs. */
export function firmwarePrompt(device: DeviceProfile, board?: Board): string {
  return [
    `Put Resident firmware on my ${device.look.leds ? `ESP32 driving a ${device.name}` : device.name}, so it comes online on Resident's relay with a device ID. I'll then drive it from porous.systems Bench (${SITE}): its Real device panel mirrors an app onto the device and streams the virtual inputs to it.`,
    '',
    '## The hardware (from Bench)',
    ...hardwareSection(device, board),
    '- Sensors and controls (encoder, PIR, light …) come from Bench while it mirrors, so the firmware needs no drivers for them.',
    '',
    '## Plan',
    ...planSection(device, board),
    '',
    '## First boot',
    '- The board opens a "Resident …" Wi-Fi hotspot: tell me to join it from my phone and enter my Wi-Fi. Then watch the serial monitor (`pio device monitor`) until it connects and prints its device ID.',
    '- Tell me the device ID. In Bench I paste it into **Real device** and press **Mirror**.',
    board && BENCH_FIRMWARE[`${device.id}|${board.id}`]
      ? `- Its \`DEVICE-SKILL.md\` (next to its \`platformio.ini\`) lists exactly which modules it has: use it when writing apps for it.`
      : '- Write a `DEVICE-SKILL.md` for this firmware (the Resident plugin\'s write-device-skill skill does this), listing exactly which modules it has, so apps can be written for it.',
    '',
    '## Rules',
    '- Ask me before anything that touches the hardware (flashing, erasing) and whenever a pin or board detail isn\'t certain.',
    '- Keep each stage buildable; if a later one breaks, go back to the last one that worked.',
    '',
  ].join('\n');
}
