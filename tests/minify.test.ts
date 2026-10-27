import { LuaFactory } from 'wasmoon';
import { describe, expect, it } from 'vitest';
import { minifyLua } from '../src/resident/minify';
import { remoteApp } from '../src/resident/remote';
import helloDisplay from '../src/resident-apps/hello-display.lua?raw';
import remoteSrc from '../src/resident/lua/remote.lua?raw';

const apps = import.meta.glob<string>('../src/resident-apps/*.lua', { query: '?raw', import: 'default', eager: true });

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
  it('drops comments, indentation, blank lines and the spaces between tokens', () => {
    expect(minifyLua('-- header\nlocal a = 1 -- trailing\n\n    if a then\n\t\treturn a\n    end\n')).toBe(
      'local a=1\nif a then\nreturn a\nend\n',
    );
    expect(minifyLua('f(a, b, { x = 1, y = "s" })\n')).toBe('f(a,b,{x=1,y="s"})\n');
  });

  it('keeps the spaces Lua needs', () => {
    // Two names or numbers; a numeral before `..`; marks that would join into another token.
    expect(minifyLua('local x = a - -b\n')).toBe('local x=a- -b\n');
    expect(minifyLua('s = 1 .. "a" .. 0xFF .. x .. .5\n')).toBe('s=1 .."a"..0xFF ..x .. .5\n');
    expect(minifyLua('v = t [ [[k]] ] < = 2\n')).toBe('v=t[ [[k]]]< =2\n');
    expect(minifyLua('if a ~= b and c <= d then return x // 2 end\n')).toBe('if a~=b and c<=d then return x//2 end\n');
    expect(minifyLua('goto top :: top ::\n')).toBe('goto top::top::\n');
  });

  it('keeps strings that contain comment markers, quotes and escapes', () => {
    const src = `local s = "a -- b"\nlocal t = 'it\\'s -- here'\nlocal u = "x\\"--y"\n`;
    expect(minifyLua(src)).toBe(`local s="a -- b"\nlocal t='it\\'s -- here'\nlocal u="x\\"--y"\n`);
  });

  it('keeps long strings verbatim, indentation and all', () => {
    const src = 'local s = [==[\n  -- not a comment\n    ]] still in\n]==]\n';
    expect(minifyLua(src)).toBe('local s=[==[\n  -- not a comment\n    ]] still in\n]==]\n');
  });

  it('drops block comments without joining the tokens around them', () => {
    expect(minifyLua('local a--[[ gone ]]=--[==[ also\ngone ]==]2\n')).toBe('local a=2\n');
    expect(minifyLua('local--[[ x ]]b = 1\n')).toBe('local b=1\n');
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

  // The same tokens compile to the same bytecode. A stripped Lua 5.4 dump still holds each
  // function's first and last line, which differ once comments and blank lines are gone: `flat`
  // zeroes them, walking the dump (header, then each function and the functions inside it).
  it('compiles every bundled app and the mirror shim to the same bytecode', async () => {
    const lua = await factory.createEngine();
    try {
      await lua.doString(`
        function flat(d)
          local pos, out, mark = 1, {}, 1
          local function byte() pos = pos + 1 return d:byte(pos - 1) end
          local function skip(n) pos = pos + n end
          local function varint() local x, b = 0 repeat b = byte() x = x * 128 + (b & 0x7f) until b >= 0x80 return x end
          local function str() local n = varint() if n > 0 then skip(n - 1) end end
          skip(12)
          local inst, int, num = byte(), byte(), byte()
          skip(int + num + 1)
          local function fn()
            str()
            out[#out + 1] = d:sub(mark, pos - 1) .. "\\0\\0"
            varint() varint()
            mark = pos
            skip(3)
            skip(varint() * inst)
            for _ = 1, varint() do
              local t = byte()
              if t == 3 then skip(int) elseif t == 19 then skip(num) elseif t == 4 or t == 20 then str() end
            end
            skip(varint() * 3)
            for _ = 1, varint() do fn() end
            skip(varint())
            for _ = 1, varint() do varint() varint() end
            for _ = 1, varint() do str() varint() varint() end
            for _ = 1, varint() do str() end
          end
          fn()
          return table.concat(out) .. d:sub(mark)
        end`);
      for (const [path, src] of Object.entries({ ...apps, 'remote.lua': remoteSrc })) {
        lua.global.set('a', src);
        lua.global.set('b', minifyLua(src));
        const same = await lua.doString('return flat(string.dump(assert(load(a)), true)) == flat(string.dump(assert(load(b)), true))');
        expect(same, path).toBe(true);
      }
    } finally {
      lua.global.close();
    }
  });

  it("shrinks Bench's Hello display for a real device", () => {
    expect(remoteApp(helloDisplay).length).toBeLessThan(11_000); // 13.4 KB before: too big to compile on the ESP32
  });
});
