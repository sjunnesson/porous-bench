// `npm run gallery -- <command>`: what the gallery shows (src/gallery/entries.json), in its order.
//
//   add <share link> [--title "Name"]   a short link (…/s/<id>) or a long one (…#share=…)
//   remove <id or link>
//   move <id or link> <position>        1 is first
//   list
//
// A short link is checked against the store it came from, and must open a setup. A long one is
// stored on Bench's site first (as Share would), so the gallery has a short id for it. The list
// holds only ids: an app's code stays in the share store, never in this repo.

import { readFileSync, writeFileSync } from 'node:fs';
import { decodeSetup } from '../src/share-format.js';

const FILE = 'src/gallery/entries.json';
const BENCH = 'https://bench.porous.systems';
const ID = /^[A-Za-z0-9_-]{12}$/;

const [command, ...args] = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? undefined : args.splice(i, 2)[1];
};

/** @returns {{ id: string, title?: string }[]} */
const read = () => JSON.parse(readFileSync(FILE, 'utf8'));
/** @param {{ id: string, title?: string }[]} list */
const write = (list) => writeFileSync(FILE, `${JSON.stringify(list, null, 2)}\n`);
const fail = (why) => {
  console.error(why);
  process.exit(1);
};

/** The id in a short link, or the id itself. */
function idOf(text) {
  if (ID.test(text)) return text;
  const m = /\/s\/([A-Za-z0-9_-]{12})\/?$/.exec(text.split(/[?#]/)[0]);
  return m?.[1];
}

/** What a setup is, in a line: the app and what it runs on. */
function describe(setup) {
  const app = 'bundled' in setup.app ? `${setup.app.bundled} (bundled)` : setup.app.name;
  const o = setup.output;
  const output = o.kind === 'display' ? o.device : o.kind === 'matrix' ? `${o.w}×${o.h} matrix` : `${o.count}-LED ${o.kind}`;
  return `${app} on ${output}`;
}

async function add(link, title) {
  if (!link) fail('Give a share link: npm run gallery -- add https://bench.porous.systems/s/<id>');
  let id = idOf(link);
  let setup;
  if (id) {
    // Read from where the link points (a dev server holds its own), else Bench's site.
    const origin = /^https?:\/\//.test(link) ? new URL(link).origin : BENCH;
    const r = await fetch(`${origin}/api/share/${id}`);
    if (!r.ok) fail(r.status === 404 ? `Nothing is stored under ${id} at ${origin}.` : `${origin} answered ${r.status}.`);
    setup = await decodeSetup(await r.text());
    if (origin !== BENCH) {
      const there = await fetch(`${BENCH}/api/share/${id}`);
      if (!there.ok) console.warn(`Note: ${id} is on ${origin} but not on Bench's site, so the deployed gallery won't find it. Share it from Bench's site, or add the long link.`);
    }
  } else {
    const hash = link.indexOf('#share=');
    if (hash < 0) fail("That isn't a share link: it has neither /s/<id> nor #share=.");
    const data = link.slice(hash + '#share='.length);
    setup = await decodeSetup(data);
    if (!setup) fail("That long link didn't open: it's damaged or cut short.");
    const r = await fetch(`${BENCH}/api/share`, { method: 'POST', body: data, headers: { 'content-type': 'text/plain' } });
    if (!r.ok) fail(`Bench's site wouldn't store it: ${r.status} ${await r.text()}`);
    id = (await r.json()).id;
  }
  if (!setup) fail("That link's setup didn't open: it's damaged.");
  const list = read();
  if (list.some((e) => e.id === id)) fail(`${id} is already in the gallery.`);
  list.push(title ? { id, title } : { id });
  write(list);
  console.log(`Added ${id}: ${describe(setup)}${title ? `, as "${title}"` : ''}. It's number ${list.length}.`);
}

function remove(which) {
  const id = which && idOf(which);
  const list = read();
  const left = list.filter((e) => e.id !== id);
  if (left.length === list.length) fail(`${which ?? '(nothing)'} isn't in the gallery.`);
  write(left);
  console.log(`Removed ${id}.`);
}

function move(which, position) {
  const id = which && idOf(which);
  const list = read();
  const at = list.findIndex((e) => e.id === id);
  const to = Number(position) - 1;
  if (at < 0) fail(`${which ?? '(nothing)'} isn't in the gallery.`);
  if (!Number.isInteger(to) || to < 0 || to >= list.length) fail(`Give a position from 1 to ${list.length}.`);
  const [entry] = list.splice(at, 1);
  list.splice(to, 0, entry);
  write(list);
  console.log(`Moved ${id} to number ${to + 1}.`);
}

async function show() {
  const list = read();
  if (!list.length) return console.log('The gallery is empty.');
  for (const [i, e] of list.entries()) {
    let what = '';
    try {
      const r = await fetch(`${BENCH}/api/share/${e.id}`);
      const setup = r.ok ? await decodeSetup(await r.text()) : null;
      what = setup ? describe(setup) : `doesn't open (${r.status})`;
    } catch {
      what = "Bench's site couldn't be reached";
    }
    console.log(`${String(i + 1).padStart(2)}. ${e.id}  ${what}${e.title ? `, as "${e.title}"` : ''}`);
  }
}

const title = flag('title');
if (command === 'add') await add(args[0], title);
else if (command === 'remove') remove(args[0]);
else if (command === 'move') move(args[0], args[1]);
else if (command === 'list') await show();
else fail('Commands: add <share link> [--title "Name"], remove <id>, move <id> <position>, list');
