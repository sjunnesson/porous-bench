// Bundled Resident Lua apps: every .lua file in this folder. The first comment line names it.

export interface BundledApp {
  id: string;
  name: string;
  description: string;
  code: string;
}

const files = import.meta.glob<string>('./*.lua', { query: '?raw', import: 'default', eager: true });

export const residentApps: BundledApp[] = Object.entries(files)
  .map(([path, code]) => {
    const id = path.replace(/^\.\/|\.lua$/g, '');
    // First comment line that isn't an attribution line: "Name: description" or just a description.
    const line = code
      .split('\n')
      .find((l) => l.startsWith('--') && !/^--\s*From /.test(l))
      ?.replace(/^--\s*/, '');
    const m = line ? /^([^:]{1,40}):\s*(.*)$/.exec(line) : null;
    return { id, name: m ? m[1] : id, description: m ? m[2] : (line ?? ''), code };
  })
  .sort((a, b) => a.name.localeCompare(b.name));
