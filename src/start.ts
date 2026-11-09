// What Bench opens on for someone new: the porous.systems logo on the Guition 4848S040, a 4″ square
// touch screen whose board has PSRAM. The app has to fit the display's default board, or Bench
// quietly starts the first app that does (tests/apps.test.ts checks it fits). Until 2026-11-09 Bench
// opened on the C6-LCD-1.47, where the logo needs more memory than the board has: everyone new got
// Accel instead.

export const FIRST_APP = 'resident:porous-systems';
export const FIRST_DISPLAY = 'guition-esp32-s3-4848s040';
