// Bench's device skill (docs/resident/DEVICE-SKILL.md), served from Bench itself so each fetch can be
// counted: the prompts Bench copies for Claude point at bench.porous.systems/device-skill.md, not at
// GitHub, whose raw files say nothing about who fetches them. The text is still GitHub's `main`, as
// before, so the skill is live once pushed. What's counted is which prompt the link came from and
// what fetched it (src/analytics.ts, `device_skill`); never the address or anything about the setup.

export const SOURCE = 'https://raw.githubusercontent.com/sjunnesson/porous-bench/main/docs/resident/DEVICE-SKILL.md';
/** The prompts that link here, by their `?from=`. */
export const FROM = ['app', 'firmware'];
/** How long a copy fetched from GitHub is served before it's fetched again. */
export const FRESH_MS = 60_000;

/**
 * What fetched the skill, from its user agent: Claude's own fetch, curl (Claude in a shell), a
 * person's browser, or something else.
 * @param {string} ua
 */
export function client(ua) {
  if (/claude/i.test(ua)) return 'claude';
  if (/^curl\//i.test(ua)) return 'curl';
  if (/mozilla/i.test(ua)) return 'browser';
  return 'other';
}

/**
 * The skill as GitHub has it, fetched at most once a minute. A copy that has gone stale still serves
 * while GitHub can't be reached.
 * @param {typeof fetch} [get]
 */
export function skillSource(get = fetch) {
  /** @type {{ text: string, at: number } | null} */
  let kept = null;
  return async () => {
    if (kept && Date.now() - kept.at < FRESH_MS) return kept.text;
    try {
      const r = await get(SOURCE, { signal: AbortSignal.timeout(5000) });
      if (!r.ok) throw new Error(`GitHub answered ${r.status}`);
      kept = { text: await r.text(), at: Date.now() };
    } catch (e) {
      if (!kept) throw e;
    }
    return kept.text;
  };
}

/**
 * GET /device-skill.md: the skill as Markdown, counted with `count(from, client)`. Counting never
 * holds the skill back.
 * @param {Request} request
 * @param {() => Promise<string>} skill
 * @param {(from: string, client: string) => Promise<void>} count
 */
export async function serveSkill(request, skill, count) {
  const asked = new URL(request.url).searchParams.get('from') ?? '';
  try {
    await count(FROM.includes(asked) ? asked : 'other', client(request.headers.get('user-agent') ?? ''));
  } catch {
    /* not counted */
  }
  try {
    // Not cached on the way: every fetch reaches this function, or it isn't counted.
    return new Response(await skill(), { headers: { 'content-type': 'text/markdown; charset=utf-8', 'cache-control': 'no-store' } });
  } catch {
    return new Response(`Bench couldn't fetch its device skill just now. The same file is at ${SOURCE}\n`, {
      status: 503,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    });
  }
}
