// A Resident Lua app as one of Bench's sketches: the app runs as run.ts runs it, and around the
// board is Bench's session (the relay, the time zone, the app loaded over the wire, the console)
// and what Bench counts (analytics.ts).

import { appBooted, appFailed, errorStage, track } from '../analytics';
import type { Sketch } from '../sim/sketch';
import { appSketch, type ResidentAppSource } from './run';
import { session } from './session';

export type { ResidentAppSource };

export function residentSketch(app: ResidentAppSource): Sketch {
  const counted = app.id ?? 'own'; // how analytics names it
  return appSketch(app, {
    zone: () => session.zone,
    persistStore: true,
    telemetry: (name, data) => {
      session.telemetry(name, data, app.generationId);
      if (name === 'compile_error') appFailed(counted, 'compile');
      if (name === 'runtime_error') appFailed(counted, errorStage(String(data?.error ?? '')));
    },
    storeFull: (key) => {
      session.telemetry('store_full', { error: key });
      appFailed(counted, 'store_full');
    },
    publish: (name, json, keep, log) => {
      const r = session.relay.publish(name, json, keep);
      log(`events.send("${name}", ${json}) → ${r}${r === 'dropped' && session.status === 'off' ? ' (connect to the relay to send)' : ''}`);
      return r;
    },
    partAdded: (kind) => track('part_added', { kind, by: 'app' }),
    booted: (host, ok) => {
      if (ok) appBooted(counted);
      session.host = host;
      if (app.live) session.persistLive(app.live);
    },
    closed: (host) => {
      if (session.host === host) session.host = null;
    },
  });
}
