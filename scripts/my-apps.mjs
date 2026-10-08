// `npm run my-apps`: set up my-apps/, a folder for your own apps that Bench's repo ignores.
// It becomes its own git repo, so you can keep it private (e.g. a private GitHub repo) while
// pulling Bench updates as usual. Safe to run again: it never overwrites anything.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = 'my-apps';
const git = (...args) => execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe' }).toString().trim();
const write = (name, text) => existsSync(join(dir, name)) || writeFileSync(join(dir, name), text);

if (existsSync(join(dir, '.git'))) {
  console.log(`${dir}/ is already set up as its own git repo.`);
  process.exit(0);
}

mkdirSync(dir, { recursive: true });
write('.gitignore', '.DS_Store\n');
write(
  'README.md',
  `# My Bench apps

Resident Lua apps I've written for my own bench. This folder sits inside a Bench checkout, which
ignores it, and is its own git repo.

Run an app by dropping its \`.lua\` file on Bench, or use **App → Watch a folder for apps**, pick
this folder, and every file saved here runs on Bench straight away.
`,
);
git('init', '-q', '-b', 'main');
git('add', '-A');
try {
  git('commit', '-q', '-m', 'My Bench apps');
} catch {
  console.log('Files are staged but not committed (set git user.name and user.email, then commit).');
}

console.log(`Set up ${dir}/: Bench's repo ignores it, and it's a git repo of its own.

To keep it in a private GitHub repo:
  gh repo create my-bench-apps --private --source ${dir} --push

Then in Bench: App → Watch a folder for apps → pick ${dir}/.`);
