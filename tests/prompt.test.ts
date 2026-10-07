import { describe, expect, it } from 'vitest';
import { appPrompt, type PromptInput } from '../src/resident/prompt';
import { findDevice } from '../src/sim/devices';
import { ledProfile } from '../src/sim/leds';

const parts: PromptInput['parts'] = [
  { id: 'builtin-button-0', kind: 'button', label: 'BOOT', builtin: true },
  { id: 'knob-1', kind: 'knob', label: 'Encoder 1', builtin: false },
  { id: 'pir-1', kind: 'pir', label: 'PIR 1', builtin: false },
];
const base: PromptInput = {
  device: findDevice('waveshare-esp32-c6-lcd-1.47')!,
  parts,
  controls: [
    { label: 'Speed', kind: 'dial', source: 'knob-1:rotate' },
    { label: 'Button A', kind: 'trigger', source: 'pir-1:motion' },
  ],
  app: { id: 'resident:patterns', name: 'Patterns', description: 'Animated LVGL patterns.', code: '-- x', bundled: true },
  deviceId: 'sim-abc12345',
  online: false,
};

describe('app prompt', () => {
  it('describes the display, the bench with its connect ids, the wiring and where to push', () => {
    const p = appPrompt(base);
    expect(p).toContain('172×320 pixels');
    expect(p).toContain('`-- @output display`');
    expect(p).toContain('rounded corners');
    expect(p).toContain('`connect = "knob-1:rotate"`');
    expect(p).toContain('`connect = "pir-1:motion"`');
    expect(p).toContain("by default it's button A (index 0)");
    expect(p).toContain('`pir.motion()`');
    expect(p).toContain('Button A (trigger) ← PIR 1 motion (`pir-1:motion`)');
    expect(p).toContain('src/resident-apps/patterns.lua');
    expect(p).toContain('`--device-id sim-abc12345`');
    expect(p).toContain('./DEVICE-SKILL.md');
    expect(p).toContain("don't look for another way");
    expect(p).toContain('docs/resident/DEVICE-SKILL.md');
    expect(p).toContain('/plugin install resident@inanimate');
  });

  it('switches to the leds module for an LED output, and inlines your own app', () => {
    const p = appPrompt({
      ...base,
      device: ledProfile({ kind: 'matrix', w: 16, h: 16 }),
      app: { id: 'resident:live', name: 'My bench', code: 'function init() end', bundled: false },
      online: true,
    });
    expect(p).toContain('16×16 WS2812B matrix');
    expect(p).toContain('leds.on_frame');
    expect(p).toContain('`-- @output matrix`');
    expect(p).not.toContain('lvgl.Anim');
    expect(p).toContain('```lua\nfunction init() end\n```');
    expect(p).toContain('connected to the relay');
  });

  it('gives a ring the strip tag and an M5Stick its landscape size', () => {
    expect(appPrompt({ ...base, device: ledProfile({ kind: 'ring', count: 12 }) })).toContain('`-- @output strip`');
    expect(appPrompt({ ...base, device: findDevice('m5stickc-plus2')! })).toContain('240×135 pixels');
  });

  it('delivers into the watched folder, with no push, when Bench is watching one', () => {
    const p = appPrompt({ ...base, watching: 'my-apps' });
    expect(p).toContain('Bench is watching my folder `my-apps`');
    expect(p).not.toContain('--device-id');
  });
});
