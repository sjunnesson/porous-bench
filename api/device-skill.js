// GET /device-skill.md (vercel.json rewrites it here): Bench's device skill, each fetch counted in
// Vercel Web Analytics (see _skill.js).
import { track } from '@vercel/analytics/server';
import { serveSkill, skillSource } from './_skill.js';

const skill = skillSource();

/** @param {Request} request */
export const GET = (request) => serveSkill(request, skill, (from, client) => track('device_skill', { from, client }, { request }));
