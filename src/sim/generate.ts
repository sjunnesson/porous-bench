// Write a starter Lua app for the bench as it stands: one control per input on the bench, each
// connected to its part, shown live on the output (a row per input on a display, a run of LEDs on
// a strip or ring, a column on a matrix). A working sketch to rewrite, not a finished app. On a
// display it's LVGL where the board has it, and lgfx where it doesn't (the e-paper driver board, the C6).

import { TEMP_RANGE } from './inputs/climate';
import { MAX_RANGE_M } from './inputs/ld2410';
import type { PartKind, PartSpec } from './controls/bench';

export type AppOutput = 'display' | 'strip' | 'matrix';

interface Control {
  label: string;
  connect: string;
  dial?: { min: number; max: number; step: number; start: number; unit: string };
}

/**
 * What each kind of part offers an app: a value (dial), a moment (trigger), or both. A sensor that's
 * the only one of its kind goes by what it reads ("Humidity"); otherwise by its name too.
 */
function controlsFor(p: PartSpec, many: boolean): Control[] {
  const named = (what: string) => (many ? `${p.label} ${what.toLowerCase()}` : what);
  const value = (label: string, channel: string, dial: Control['dial']): Control => ({ label, connect: `${p.id}:${channel}`, dial });
  const moment = (label: string, channel: string): Control => ({ label, connect: `${p.id}:${channel}` });
  const pct = { min: 0, max: 100, step: 1, start: 50, unit: '%' };
  const tilt = { min: -100, max: 100, step: 1, start: 0, unit: '' };
  const kinds: Record<PartKind, Control[]> = {
    button: [moment(p.label, 'press')],
    touch: [moment(p.label, 'touch')],
    knob: [value(p.label, 'rotate', { min: 0, max: 100, step: 5, start: 50, unit: '' }), moment(`${p.label} push`, 'push')],
    pot: [value(p.label, 'position', pct)],
    imu: [value(named('Tilt x'), 'tilt-x', tilt), value(named('Tilt y'), 'tilt-y', tilt), moment(named('Shake'), 'shake')],
    ld2410: [
      value(named('Distance'), 'distance', { min: 0, max: MAX_RANGE_M * 100, step: 1, start: 0, unit: ' cm' }),
      moment(named('Presence'), 'presence'),
    ],
    pir: [moment(named('Motion'), 'motion')],
    light: [value(named('Light'), 'level', { ...pct, start: 0 }), moment(named('Dark'), 'dark')],
    climate: [
      value(named('Temp'), 'temperature', { min: TEMP_RANGE[0], max: TEMP_RANGE[1], step: 1, start: 21, unit: ' C' }),
      value(named('Humidity'), 'humidity', { ...pct, start: 40 }),
    ],
    buzzer: [],
  };
  return kinds[p.kind] ?? [];
}

// Keys for each dial after the first (which keeps ← →), so each moves alone: [down, up, as shown].
const DIAL_KEYS = [
  ['ArrowDown', 'ArrowUp', '↓ ↑'],
  ['BracketLeft', 'BracketRight', '[ ]'],
  ['Minus', 'Equal', '- ='],
  ['Comma', 'Period', ', .'],
  ['Semicolon', 'Quote', "; '"],
  ['KeyZ', 'KeyX', 'Z X'],
  ['KeyN', 'KeyM', 'N M'],
];

const lua = (s: string) => JSON.stringify(s); // a double-quoted string Lua reads the same way

/** The Lua for the `inputs` table: one entry per control, connected to its part. */
function inputsTable(controls: Control[]): string {
  let dials = 0;
  let triggers = 0;
  const rows = controls.map((c) => {
    if (c.dial) {
      const d = c.dial;
      const k = dials > 0 ? DIAL_KEYS[dials - 1] : undefined;
      const keys = k ? `, keys = { down = ${lua(k[0])}, up = ${lua(k[1])} }` : '';
      const note = dials === 0 ? ' -- keys ← →' : k ? ` -- keys ${k[2]}` : '';
      dials++;
      return `  value(${lua(c.label)}, ${lua(d.unit)}, { min = ${d.min}, max = ${d.max}, step = ${d.step}, start = ${d.start}, connect = ${lua(c.connect)}${keys} }),${note}`;
    }
    triggers++;
    const key = triggers <= 9 ? `, key = "Digit${triggers}"` : '';
    return `  moment(${lua(c.label)}, { connect = ${lua(c.connect)}${key} }),${key ? ` -- key ${triggers}` : ''}`;
  });
  return `-- A value from a part (turned, slid, tilted, measured) and a moment (pressed, touched, sensed).
local function value(label, unit, opts) return { label = label, unit = unit, dial = dial.new(label, opts) } end
local function moment(label, opts) return { label = label, trigger = trigger.new(label, opts) } end

local inputs = {
${rows.join('\n')}
}`;
}

function head(output: AppOutput, parts: PartSpec[], hasBuzzer: boolean, boardButtons: boolean): string {
  const where = output === 'display' ? 'on the screen' : output === 'strip' ? 'on the LEDs' : 'on the matrix';
  return [
    `-- My bench: every input on the bench, live ${where}. Generated from your bench as a starting point: edit it into your app.`,
    `-- @output ${output}`,
    `-- On the bench: ${parts.map((p) => p.label).join(', ') || 'nothing yet'}.`,
    '-- Each control below is connected to one part; change that in Connections, or edit `connect`.',
    ...(boardButtons ? ["-- The board's own buttons stay Button A and B (the A and B keys)."] : []),
    ...(hasBuzzer ? ['-- The buzzer clicks on every press.'] : []),
  ].join('\n');
}

const PRESSES = (hasBuzzer: boolean) => `-- Your app: what each press does. Here it counts it, logs it${hasBuzzer ? ', clicks the buzzer' : ''} and flashes.
local function pressed(input)
  input.count = (input.count or 0) + 1
  log.info(input.label .. " pressed (" .. input.count .. ")")${hasBuzzer ? '\n  buzzer.beep(2200, 25)' : ''}
end`;

function displayApp(presses: string): string {
  return `local h = lvgl.bind("main")
local s = screens.get("main")
local W, H = h.HOR_RES(), h.VER_RES()
local paper = s.scheme == "light" -- e-paper: every change is a slow refresh, so nothing animates
local color = s.depth == 16
local BG = paper and "#ffffff" or color and "#101018" or "#000000"
local FG = paper and "#000000" or color and "#ececf2" or "#ffffff"
local TRACK = color and "#2a2a3a" or BG
local HUES = { "#5ac8fa", "#ff9f43", "#7bed9f", "#ff6b81", "#a29bfe", "#feca57" }

-- One row per input: its name and value, and a bar under them. If they don't all fit, the list
-- pages through them.
local perPage = math.max(1, math.min(#inputs, (H - 4) // 18))
local rowH = math.min(40, (H - 4) // perPage)
local pages = math.ceil(#inputs / perPage)
local BAR = math.max(2, math.min(6, rowH // 7))
local SIZE = math.min(W < 160 and 14 or 20, rowH - BAR - 6)
h:set_theme {
  screen = { bg_color = BG },
  object = { bg_opa = 0, border_width = 0, pad_all = 0, radius = 0 },
  label = { text_color = FG, text_font = lvgl.Font("montserrat", SIZE) },
}
local barW = W - 16

-- A page-high window onto the list: the list slides inside it, and the window hides the next page.
local window = h.Object { x = 0, y = 2, w = W, h = perPage * rowH }
local list = window:Object { w = W, h = math.max(1, #inputs) * rowH }
for i, input in ipairs(inputs) do
  local accent = color and HUES[(i - 1) % #HUES + 1] or FG
  local row = list:Object { x = 8, y = (i - 1) * rowH, w = barW, h = rowH }
  -- The name, in a box that trims it short of the value ("100%" for a dial, "x12" for a trigger).
  row:Object { w = barW - (input.dial and 3 or 2) * SIZE, h = rowH }:Label { text = input.label }
  input.text = row:Label { text = "", align = lvgl.ALIGN.TOP_RIGHT }
  row:Object { y = rowH - BAR - 3, w = barW, h = BAR, bg_color = TRACK, bg_opa = 255, radius = BAR // 2,
    border_width = color and 0 or 1, border_color = FG }
  -- A dial fills its bar; a trigger lights the whole bar and fades.
  input.bar = row:Object { y = rowH - BAR - 3, w = input.dial and 0 or barW, h = BAR, bg_color = accent,
    bg_opa = input.dial and 255 or 0, radius = BAR // 2 }
  input.motion = { at = 0 }
end

-- Move one property to \`to\` with an Anim on LVGL's own pump (smoother than the 10 Hz tick), from
-- wherever it is now. \`m\` keeps the Anim and the value. E-paper jumps straight there.
local function glide(m, obj, prop, to, ms)
  if m.anim then m.anim:stop() m.anim = nil end
  if paper or ms == 0 or m.at == to then
    m.at = to
    obj:set { [prop] = to }
    return
  end
  m.anim = obj:Anim {
    start_value = m.at, end_value = to, duration = ms, path = "ease_out",
    exec_cb = function(o, v) m.at = v o:set { [prop] = v } end,
    run = true,
  }
end

${presses}

local page, turned, scroll = 0, 0, { at = 0 }
function on_tick(ctx)
  for _, input in ipairs(inputs) do
    if input.dial then
      local v = input.dial:value()
      if v ~= input.shown then
        input.shown = v
        input.text:set { text = string.format("%d%s", v, input.unit) }
        glide(input.motion, input.bar, "w", math.floor(input.dial:fraction() * barW + 0.5), 150)
      end
    else
      if input.trigger:was_pressed() then
        pressed(input)
        input.text:set { text = "x" .. input.count }
      end
      local down = input.trigger:is_pressed()
      if down ~= input.down then
        input.down = down
        glide(input.motion, input.bar, "bg_opa", down and 255 or 0, down and 0 or 400) -- lit while held
      end
    end
  end
  -- More rows than fit: the next page every 3 s (e-paper: every 15 s, it's a full refresh).
  if pages > 1 and ctx.time_ms - turned >= (paper and 15000 or 3000) then
    turned = ctx.time_ms
    page = (page + 1) % pages
    glide(scroll, list, "translate_y", -page * perPage * rowH, 450)
  end
end
`;
}

/**
 * The display app in lgfx, for boards without LVGL: the same rows, redrawn only when one changes.
 * Kept small: on the e-paper driver board it must fit next to the mirror's stand-ins in ~39 KB.
 */
function lgfxDisplayApp(presses: string): string {
  return `local g = lgfx.bind("main")
local s = screens.get("main")
local W, H = g:width(), g:height()
local paper = s.scheme == "light" -- e-paper: every change is a slow refresh
local BG = paper and 0xFFFFFF or 0x000000
local FG = paper and 0x000000 or 0xFFFFFF
local ACCENT = s.depth == 16 and 0x5AC8FA or FG

-- One row per input: its name and value, and a bar under them. If they don't all fit, the list
-- pages through them. The built-in font is 6 × 8 px a character at size 1.
local SIZE = (W >= 200 and H >= 120) and 2 or 1
local rowH = 11 * SIZE + 7
local perPage = math.max(1, math.min(#inputs, (H - 4) // rowH))
local pages = math.ceil(#inputs / perPage)
local barW = W - 16
local chars = (barW - 30 * SIZE) // (6 * SIZE) -- a name stops short of its value

${presses}

local page, turned, shown = 0, 0
local function draw()
  -- What the screen would show: unchanged, there's nothing to flip (on e-paper, each flip is a refresh).
  local frame = page
  for _, input in ipairs(inputs) do
    frame = frame .. "|" .. (input.dial and input.dial:value() or (input.count or 0) .. (input.down and "*" or ""))
  end
  if frame == shown then return end
  shown = frame
  g:fillScreen(BG)
  g:setTextSize(SIZE)
  g:setTextColor(FG)
  for k = 1, perPage do
    local input = inputs[page * perPage + k]
    if not input then break end
    local y = 2 + (k - 1) * rowH
    g:setTextDatum(lgfx.TL_DATUM)
    g:drawString(input.label:sub(1, chars), 8, y)
    g:setTextDatum(lgfx.TR_DATUM)
    g:drawString(input.dial and string.format("%d%s", input.dial:value(), input.unit) or input.count and "x" .. input.count or "", 8 + barW, y)
    -- A dial fills its bar; a trigger fills it while it's held.
    y = y + 8 * SIZE + 2
    g:drawRect(8, y, barW, 3 * SIZE, FG)
    local fill = input.dial and math.floor(input.dial:fraction() * barW + 0.5) or input.down and barW or 0
    if fill > 0 then g:fillRect(8, y, fill, 3 * SIZE, ACCENT) end
  end
  g:flip()
end

function on_tick(ctx)
  for _, input in ipairs(inputs) do
    if input.trigger then
      if input.trigger:was_pressed() then pressed(input) end
      input.down = input.trigger:is_pressed()
    end
  end
  -- More rows than fit: the next page every 3 s (e-paper: every 15 s).
  if pages > 1 and ctx.time_ms - turned >= (paper and 15000 or 3000) then
    turned = ctx.time_ms
    page = (page + 1) % pages
  end
  draw()
end
`;
}

function stripApp(presses: string): string {
  return `local n = leds.count()
leds.brightness(128) -- half power: plenty indoors, and kind to the 5 V supply
-- Each input gets an equal run of LEDs in its own colour (as many inputs as there are LEDs).
local shown = math.min(#inputs, n)
for i = 1, shown do
  local input = inputs[i]
  input.first = math.floor((i - 1) * n / shown)
  input.len = math.floor(i * n / shown) - input.first
  input.hue = (i - 1) * 360 / shown
  input.flash = 0
end

${presses}

function on_tick(ctx)
  for i = 1, shown do
    local input = inputs[i]
    if input.trigger and input.trigger:was_pressed() then
      pressed(input)
      input.flash = 1
    end
  end
end

-- The LED driver's frame timer, 50 times a second: a dial lights its run up to its value, a
-- trigger lights its whole run while held and fades after.
leds.on_frame(function(ctx, dt_ms)
  for i = 1, shown do
    local input = inputs[i]
    if input.dial then
      local lit = input.dial:fraction() * input.len
      for k = 0, input.len - 1 do
        local v = math.max(0.03, math.min(1, lit - k)) -- the last lit LED shows the fraction
        leds.set(input.first + k, leds.hsv(input.hue, 1, v))
      end
    else
      if input.trigger:is_pressed() then input.flash = 1 end
      input.flash = input.flash * math.exp(-dt_ms / 250)
      for k = 0, input.len - 1 do
        leds.set(input.first + k, leds.hsv(input.hue, 1, math.max(0.03, input.flash)))
      end
    end
  end
  leds.show()
end)
`;
}

function matrixApp(presses: string): string {
  return `local W, H = leds.width(), leds.height()
leds.brightness(96) -- a lit matrix is bright: keep it gentle
-- Each input gets an equal band of columns in its own colour (as many inputs as there are columns).
local shown = math.min(#inputs, W)
for i = 1, shown do
  local input = inputs[i]
  input.x = math.floor((i - 1) * W / shown)
  input.cols = math.floor(i * W / shown) - input.x
  input.hue = (i - 1) * 360 / shown
  input.flash = 0
end

${presses}

function on_tick(ctx)
  for i = 1, shown do
    local input = inputs[i]
    if input.trigger and input.trigger:was_pressed() then
      pressed(input)
      input.flash = 1
    end
  end
end

-- 50 times a second: a dial is a bar rising from the bottom, a trigger fills its band and fades.
leds.on_frame(function(ctx, dt_ms)
  for i = 1, shown do
    local input = inputs[i]
    local level
    if input.dial then
      level = input.dial:fraction() * H
    else
      if input.trigger:is_pressed() then input.flash = 1 end
      input.flash = input.flash * math.exp(-dt_ms / 250)
    end
    for y = 0, H - 1 do
      local v
      if level then v = math.max(0.03, math.min(1, level - (H - 1 - y)))
      else v = math.max(0.03, input.flash) end
      for x = input.x, input.x + input.cols - 1 do
        leds.set(leds.xy(x, y), leds.hsv(input.hue + y * 4, 1, v))
      end
    end
  end
  leds.show()
end)
`;
}

/**
 * A Lua app that shows every input on the bench on the chosen output. `libraries`: the board's
 * (`Board.libraries`); without `lvgl`, a display gets the lgfx version.
 */
export function benchApp(output: AppOutput, parts: (PartSpec & { builtin?: boolean })[], libraries: string[] = ['screen', 'lgfx', 'lvgl']): string {
  // The board's own buttons already drive the app's A and B, so they aren't listed again.
  const boardButton = (p: (typeof parts)[number]) => p.kind === 'button' && !!p.builtin;
  const inputs = parts.filter((p) => !boardButton(p) && p.kind !== 'buzzer');
  const hasBuzzer = parts.some((p) => p.kind === 'buzzer');
  const count = (k: PartKind) => inputs.filter((p) => p.kind === k).length;
  const controls = inputs.flatMap((p) => controlsFor(p, count(p.kind) > 1));
  // Labels name the controls, so they must differ (two parts can share a name).
  const seen = new Map<string, number>();
  for (const c of controls) {
    const n = (seen.get(c.label) ?? 0) + 1;
    seen.set(c.label, n);
    if (n > 1) c.label = `${c.label} (${n})`;
  }
  const app = output === 'display' ? (libraries.includes('lvgl') ? displayApp : lgfxDisplayApp) : output === 'strip' ? stripApp : matrixApp;
  const none = controls.length ? '' : '-- Nothing on the bench to read yet: add parts in Inputs, then make the app again.\n';
  return `${head(output, inputs, hasBuzzer, parts.some(boardButton))}

${none}${inputsTable(controls)}

${app(PRESSES(hasBuzzer))}`;
}
