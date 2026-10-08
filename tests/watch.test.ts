// Watching a folder: with edit access Bench puts its device skill there; refused, it watches read-only.

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import skill from '../docs/resident/DEVICE-SKILL.md?raw';

type Mode = 'read' | 'readwrite';

/** A folder as the File System Access API hands it over, granting what `grants` says. */
function fakeFolder(grants: Record<Mode, PermissionState>) {
  const files = new Map<string, string>();
  return {
    files,
    kind: 'directory' as const,
    name: 'my-apps',
    async *values() {},
    async getFileHandle(name: string, o?: { create?: boolean }) {
      if (!files.has(name)) {
        if (!o?.create) throw new DOMException('not found', 'NotFoundError');
        files.set(name, '');
      }
      return {
        getFile: async () => new File([files.get(name)!], name),
        createWritable: async () => {
          let text = '';
          return { write: async (d: string) => void (text += d), close: async () => void files.set(name, text) };
        },
      };
    },
    queryPermission: async ({ mode }: { mode: Mode }) => grants[mode],
    requestPermission: async ({ mode }: { mode: Mode }) => grants[mode],
  };
}

const picker = vi.fn();
let folderWatch: typeof import('../src/resident/watch').folderWatch;

beforeAll(async () => {
  vi.stubGlobal('window', { showDirectoryPicker: picker });
  ({ folderWatch } = await import('../src/resident/watch'));
});
afterEach(() => {
  folderWatch.stop();
  picker.mockReset();
});

describe('watching a folder', () => {
  it('asks for edit access and puts the device skill in the folder', async () => {
    const folder = fakeFolder({ read: 'granted', readwrite: 'granted' });
    picker.mockResolvedValue(folder);
    await folderWatch.pick();
    expect(picker).toHaveBeenCalledWith(expect.objectContaining({ mode: 'readwrite' }));
    expect(folderWatch.folder).toBe(folder);
    expect(folderWatch.skill).toBe(true);
    expect(folder.files.get('DEVICE-SKILL.md')).toBe(skill);
  });

  it('offers read-only when edit access is refused, and watches without writing', async () => {
    picker.mockRejectedValueOnce(new DOMException('aborted', 'AbortError'));
    await folderWatch.pick();
    expect(folderWatch.folder).toBeNull();
    expect(folderWatch.refused).toBe(true);

    const folder = fakeFolder({ read: 'granted', readwrite: 'denied' });
    picker.mockResolvedValue(folder);
    await folderWatch.pick('read');
    expect(picker).toHaveBeenLastCalledWith(expect.objectContaining({ mode: 'read' }));
    expect(folderWatch.folder).toBe(folder);
    expect(folderWatch.mode).toBe('read');
    expect(folderWatch.skill).toBe(false);
    expect(folderWatch.refused).toBe(false);
    expect(folder.files.has('DEVICE-SKILL.md')).toBe(false);
  });

  it('lets a read-only folder grant edit access later', async () => {
    const folder = fakeFolder({ read: 'granted', readwrite: 'granted' });
    picker.mockResolvedValue(folder);
    await folderWatch.pick('read');
    expect(folder.files.has('DEVICE-SKILL.md')).toBe(false);
    await folderWatch.allowEdit();
    expect(folderWatch.mode).toBe('readwrite');
    expect(folderWatch.skill).toBe(true);
    expect(folder.files.get('DEVICE-SKILL.md')).toBe(skill);
  });

  it('resumes last time\'s folder read-only when edit access is refused', async () => {
    const folder = fakeFolder({ read: 'granted', readwrite: 'denied' });
    folderWatch.saved = folder;
    await folderWatch.resume();
    expect(folderWatch.folder).toBeNull();
    expect(folderWatch.refused).toBe(true);
    await folderWatch.resume('read');
    expect(folderWatch.folder).toBe(folder);
    expect(folderWatch.mode).toBe('read');
    expect(folder.files.has('DEVICE-SKILL.md')).toBe(false);
  });
});
