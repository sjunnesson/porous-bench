import type { DeviceProfile } from './types';

// Every other .ts file in this folder is a device: drop a new file in to add one.
const modules = import.meta.glob<{ default: DeviceProfile }>(['./*.ts', '!./index.ts', '!./types.ts'], { eager: true });

export const devices: DeviceProfile[] = Object.values(modules)
  .map((m) => m.default)
  .sort((a, b) => techOrder(a) - techOrder(b) || a.name.localeCompare(b.name));

export function findDevice(id: string): DeviceProfile | undefined {
  return devices.find((d) => d.id === id);
}

function techOrder(d: DeviceProfile) {
  return { lcd: 0, oled: 1, epaper: 2 }[d.tech];
}

export type { DeviceProfile, Tech } from './types';
