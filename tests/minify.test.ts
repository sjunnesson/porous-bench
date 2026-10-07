import { LuaFactory } from 'wasmoon';
import { describe, expect, it } from 'vitest';
import { minifyLua } from '../src/resident/minify';
import { remoteApp } from '../src/resident/remote';
import helloDisplay from '../src/resident-apps/hello-display.lua?raw';

const factory = new LuaFactory();

async function run(code: string): Promise<unknown> {
  const lua = await factory.createEngine();
  try {
    return await lua.doString(code);
  } finally {
    lua.global.close();
  }
}

describe('minifyLua', () => {
  it('drops comments, indentation and blank lines', () => {
    expect(minifyLua('-- header\nlocal a = 1 -- trailing\n\n    if a then\n\t\treturn a\n    end\n')).toBe(
      'local a = 1\nif a then\nreturn a\nend\n',
    );
  });

  it('keeps strings that contain comment markers, quotes and escapes', () => {
    const src = `local s = "a -- b"\nlocal t = 'it\\'s -- here'\nlocal u = "x\\"--y"\n`;
    expect(minifyLua(src)).toBe(src);
  });

  it('keeps long strings verbatim, indentation and all', () => {
    const src = 'local s = [==[\n  -- not a comment\n    ]] still in\n]==]\n';
    expect(minifyLua(src)).toBe(src);
  });

  it('drops block comments without joining the tokens around them', () => {
    expect(minifyLua('local a--[[ gone ]]=--[==[ also\ngone ]==]2\n')).toBe('local a = 2\n');
  });

  it('runs the same as the original', async () => {
    const src = `
      -- sums with a comment in the way
      local function f(n) --[[ block ]] local s = 0
        for i = 1, n do s = s + i end -- loop
        return s .. " -- " .. [[raw -- text]]
      end
      return f(4)`;
    expect(await run(minifyLua(src))).toBe(await run(src));
  });

  it("shrinks Bench's Hello display for a real device", () => {
    expect(remoteApp(helloDisplay).length).toBeLessThan(11_000); // 13.4 KB before: too big to compile on the ESP32
  });
});
