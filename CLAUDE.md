# porous.systems Bench

A browser simulator for ESP32 displays, LED chains and the inputs around them, running Resident Lua
apps; it can also mirror an app onto a real Resident board. Live at https://bench.porous.systems.

## Layout

- `src/sim/`: the simulated hardware. `devices/` (one profile per output), `boards.ts` (the boards
  that drive them: libraries, app memory), `display.ts` + `panels/` (bus and refresh timing),
  `controls/` (the bench: parts, dials, triggers), `inputs/`, `wiring.ts` (which board pin each part
  goes to: the Wiring view).
- `src/resident/`: the Resident runtime in the browser (`host.ts`), each sensor's driver (`drivers.ts`:
  its Lua reading, its events, what the mirror sends), matching apps to hardware
  (`needs.ts`), the mirror to a real board (`remote.ts` + `lua/remote.lua`, the shim it wraps apps
  in), and the prompts Bench copies for Claude (`prompt.ts` for apps, `firmware.ts` for firmware).
- `src/resident-apps/`: bundled Lua apps. `docs/resident/DEVICE-SKILL.md`: Bench's device skill.
- `src/share.ts`: share links. A long link carries the setup after `#share=`
  (`src/share-format.js`); a short one, `/s/<id>`, names it, kept in Upstash Redis by the Vercel
  functions in `api/` (the dev server keeps them in memory). `api/` and the format are plain
  JavaScript checked through JSDoc: Vercel's builder can't compile TypeScript 7.
- `src/gallery/`: the gallery at `/gallery` (`gallery.html`): apps running live as just their
  screens at real size, used by pointing (keys, touch, tilt: `pointer.ts`), each entry a short
  share link's id in `entries.json` (`npm run gallery -- add <link>`), run through
  `src/resident/run.ts` as Bench runs them but without touching the visitor's storage or sending
  Bench's events (it counts page views only).
- `firmware/`: Resident firmware Bench ships for real boards (PlatformIO; Resident pinned by commit).
- `my-apps/`: the user's own apps. Ignored by this repo and its own git repo (`npm run my-apps`).
- `apple/`: the native app (macOS, iPhone, iPad). Ignored by this repo and its own private git repo; when
  it's there, read its `CLAUDE.md` before changing the Resident runtime, the display pipeline or `remote.lua`.

## Commands

- `npm test` (vitest), `npm run typecheck`, `npm run build`; dev server: `npx vite`.
- Pushing `main` deploys production on Vercel; don't also run `vercel --prod` (it deploys twice).

## Conventions

- **Bench must behave like the real hardware.** When a real board and Bench disagree, fix Bench to
  match the board (e.g. e-paper refreshes one frame at a time, newest wins; every button press
  counts). Measure on hardware before changing a model.
- **Every bundled app says what it needs.** Line 1 `-- Name: description`; `-- @output strip|matrix`
  for LED apps; `-- @needs motion color touch WxH` for what the code can't show (animates / colour
  only / needs a touch panel / smallest screen its fixed layout fits). Libraries and memory are read from the code
  (`needs.ts`). Tests fail if an app runs nowhere or doesn't boot wrapped for a real device.
- **Apps someone writes for themselves go in `my-apps/`**, not `src/resident-apps/` or the repo
  root, and are committed in that repo (`git -C my-apps …`), never in Bench's. Only apps meant to
  ship with Bench are bundled.
- **A new output or board** goes in `src/sim/devices/` or `src/sim/boards.ts` with its libraries
  and its app memory: the PSRAM size on a board with PSRAM, otherwise *measured*
  (`heap_caps_get_free_size(MALLOC_CAP_8BIT)` after Wi-Fi + TLS, not `ESP.getFreeHeap()`);
  unmeasured stays unset. A board also gets its free header GPIOs in `src/sim/wiring.ts` (from its
  schematic, leaving out straps, flash/PSRAM, USB and what the board uses; `i2c.own` when its own
  chips share the I2C bus, `keys` for the pins Bench's firmware reads), which the Wiring view and
  the firmware prompt wire parts to, and an outline on the 3D desk (`MCU` in
  `src/ui/three/peripherals.ts`) unless it has a display of its own. Keep the Boards table and the share-link ids in
  DEVICE-SKILL.md in step (`tests/device-skill.test.ts` checks its displays, boards, share-link ids
  and part channels, Lua modules and Mirror stand-ins).
- **A new part** (an input on the bench): its model in `src/sim/inputs/` (several keys or tags:
  `keys.ts`, so each press carries a code; discrete events: an `EventLog`), its kind, channels and
  `createPart` in `controls/bench.ts`, how its channels read in `IO` and any `via` names in
  `controls.ts`, its driver in `drivers.ts`, its Lua module in `lua/prelude.lua` and stand-in in
  `lua/remote.lua` (with its events in the replay section), its module in `wiring.ts` (with its I2C
  address and any others), a widget in `src/ui/widgets/`, a desk part in `peripherals.ts`, its
  starter controls in `generate.ts`, and `prompt.ts`, DEVICE-SKILL.md and the guide. Model it from
  the datasheet, say so, and measure once one is on the desk.
- **The mirror shim is compiled on the device**, often in ~70 KB: keep `lua/remote.lua` small, put
  each stand-in between `-- @@part <module>` / `-- @@end` (sent only to apps that name it). While
  Bench mirrors, buttons A/B arrive as the taps and holds Bench's host recognised
  (`gestureCounts()`) and touches as Bench saw them. Never suppress a physical input on the board:
  its own keys and touch panel always reach the app, even though the two screens can then differ.
- **Other Claude sessions learn Bench from the prompts and the device skill.** When behaviour
  changes, update `prompt.ts`, `firmware.ts` (shipped firmware in `BENCH_FIRMWARE`, hardware
  lessons in `LESSONS`) and `docs/resident/DEVICE-SKILL.md` (prompts fetch it from Bench's
  `/device-skill.md`, which serves GitHub's `main` and counts the fetch, so it's live once pushed).
  People learn it from the guide at `/guide` (`src/ui/Guide.tsx`): keep its steps true too;
  `tests/guide.test.ts` checks every control it names still exists.
- **Firmware for a real board** lives in `firmware/<name>/`, one buildable PlatformIO project per
  stage of Resident's start-building guide, with a README of what bring-up taught. Ask before
  flashing a board.
- **What Bench counts** (Vercel Web Analytics custom events, at most two values each on Pro) is
  `src/analytics.ts`, every event listed in `privacy.html` (`tests/analytics.test.ts` checks): only
  Bench's own names (a bundled app's id, a display, a part's kind, a kind of error), never a person's
  code, app or folder name, device ID, error text or share-link id. A new event changes both.
- Commits: a short title, then a body that says why. Comments and docs in plain, concrete prose.
