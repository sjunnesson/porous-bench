import { LuaFactory } from 'wasmoon';
import wasmUrl from 'wasmoon/dist/glue.wasm?url';

let factory: Promise<LuaFactory> | null = null;

/** One shared wasm module; each app gets its own engine (a fresh Lua state). */
export function luaFactory(): Promise<LuaFactory> {
  factory ??= Promise.resolve(new LuaFactory(wasmUrl));
  return factory;
}
