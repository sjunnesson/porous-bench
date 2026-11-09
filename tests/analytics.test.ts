// What Bench counts (src/analytics.ts) stays what privacy.html says it counts, in Bench's own words
// rather than a person's; and the device skill is served, and counted, from Bench (api/_skill.js).

import { describe, expect, it } from 'vitest';
import { client, FRESH_MS, serveSkill, skillSource, SOURCE } from '../api/_skill.js';
import { appRef, errorKind, errorStage, EVENTS, misfitKind } from '../src/analytics';
import { firmwarePrompt } from '../src/resident/firmware';
import { type AppNeeds, misfits, type OutputCaps } from '../src/resident/needs';
import { findDevice } from '../src/sim/devices';
import privacy from '../privacy.html?raw';
import prelude from '../src/resident/lua/prelude.lua?raw';
import vercel from '../vercel.json';

describe('analytics events', () => {
  it('are each listed in the privacy policy, with at most the two values Vercel keeps on Pro', () => {
    for (const [name, values] of Object.entries(EVENTS)) {
      expect(privacy, name).toContain(`<code>${name}</code>`);
      expect(values.length, name).toBeLessThanOrEqual(2);
    }
  });

  it("name apps by Bench's ids, and everything of the visitor's as own", () => {
    expect(appRef('resident:led-fire')).toBe('led-fire');
    expect(appRef('resident:live')).toBe('own');
  });

  it("send an error's kind, never its text", () => {
    expect(errorKind(new TypeError('cannot read foo of my_secret_var'))).toBe('TypeError');
    expect(errorKind('a thrown string')).toBe('other');
    expect(errorKind(Object.assign(new Error('x'), { name: 'my app: broke' }))).toBe('other');
  });

  it("tell the Lua errors apart by Resident's own messages", () => {
    expect(prelude).toContain('"execution deadline exceeded ("');
    expect(prelude).toContain('"app halted: "');
    expect(errorStage('app halted: caught the deadline, so there it would hang')).toBe('halt');
    expect(errorStage('[string "app"]:3: execution deadline exceeded (1000 ms)')).toBe('deadline');
    expect(errorStage('not enough memory')).toBe('memory');
    expect(errorStage('[string "app"]:9: attempt to index a nil value')).toBe('runtime');
  });

  it('count each reason misfits() gives, and leave out an app made for another output', () => {
    const caps: OutputCaps = { output: 'display', w: 128, h: 64, color: false, motion: false, touch: false, haptic: false, libraries: ['screen'], appRamKb: 40 };
    const needs: AppNeeds = { output: 'display', libraries: ['lvgl'], motion: true, color: true, touch: true, haptic: true, min: { w: 240, h: 240 }, ramKb: 200 };
    expect(misfits(needs, caps).map(misfitKind)).toEqual(['lib:lvgl', 'motion', 'colour', 'touch', 'haptic', 'size', 'memory']);
    expect(misfits({ ...needs, output: 'strip' }, caps).map(misfitKind)).toEqual([null]);
  });
});

describe('the device skill, served from Bench', () => {
  const skill = '# Bench device skill\n';
  const request = (query: string, ua: string) => new Request(`https://bench.porous.systems/device-skill.md${query}`, { headers: { 'user-agent': ua } });

  it('is what both prompts link to, through the rewrite to its function', () => {
    expect(firmwarePrompt(findDevice('waveshare-esp32-c6-lcd-1.47')!)).toContain('https://bench.porous.systems/device-skill.md?from=firmware');
    expect(vercel.rewrites).toContainEqual({ source: '/device-skill.md', destination: '/api/device-skill' });
  });

  it('counts which prompt it came from and what fetched it, and serves it uncached', async () => {
    const counted: string[][] = [];
    const count = async (from: string, by: string) => void counted.push([from, by]);
    const r = await serveSkill(request('?from=app', 'Claude-User (claude-code/2.1; +https://support.anthropic.com/)'), async () => skill, count);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(await r.text()).toBe(skill);
    await serveSkill(request('?from=firmware', 'curl/8.7.1'), async () => skill, count);
    await serveSkill(request('?from=<script>', 'Mozilla/5.0'), async () => skill, count);
    await serveSkill(request('', 'python-requests/2.32'), async () => skill, count);
    expect(counted).toEqual([
      ['app', 'claude'],
      ['firmware', 'curl'],
      ['other', 'browser'],
      ['other', 'other'],
    ]);
  });

  it("still serves when counting fails, and says where else to get it when it can't", async () => {
    const r = await serveSkill(request('?from=app', 'curl/8'), async () => skill, () => Promise.reject(new Error('insights down')));
    expect(await r.text()).toBe(skill);
    const down = await serveSkill(request('?from=app', 'curl/8'), () => Promise.reject(new Error('GitHub down')), async () => {});
    expect(down.status).toBe(503);
    expect(await down.text()).toContain(SOURCE);
  });

  it("fetches GitHub's copy at most once a minute, and keeps a stale one while GitHub is out of reach", async () => {
    let calls = 0;
    let up = true;
    const get = (async () => (calls++, up ? new Response(`v${calls}`) : new Response('', { status: 500 }))) as typeof fetch;
    const source = skillSource(get);
    expect(await source()).toBe('v1');
    expect(await source()).toBe('v1');
    expect(calls).toBe(1);
    const now = Date.now;
    try {
      Date.now = () => now() + FRESH_MS + 1;
      up = false;
      expect(await source()).toBe('v1');
      expect(calls).toBe(2);
    } finally {
      Date.now = now;
    }
    await expect(skillSource(get)()).rejects.toThrow('GitHub answered 500');
  });

  it('tells Claude, curl and a browser apart', () => {
    expect(client('Claude-User/1.0')).toBe('claude');
    expect(client('curl/8.7.1')).toBe('curl');
    expect(client('Mozilla/5.0 (Macintosh)')).toBe('browser');
    expect(client('')).toBe('other');
  });
});
