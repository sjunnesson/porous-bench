import { useState, useSyncExternalStore } from 'react';
import { firmwarePrompt } from '../resident/firmware';
import { type MirrorSource, remote, type SavedDevice } from '../resident/remote';
import type { Board } from '../sim/boards';
import { findDevice } from '../sim/devices';
import type { DeviceProfile } from '../sim/devices/types';
import { Copy } from './Copy';
import { Panel } from './Panel';

interface Props {
  /** The selected output: what the firmware prompt is for. */
  device: DeviceProfile;
  /** The board chosen to drive it. */
  board?: Board;
  /** The app open on Bench. */
  app: { name: string; code: string };
  /** What drives it, read on every update. */
  source: () => MirrorSource;
  /** Show this display on Bench (a saved board's, when Bench shows another). */
  onShow: (displayId: string) => void;
  /** The time zone Bench's apps run in, sent to the board so its local time matches. */
  tz: string;
}

const STATUS = {
  off: '',
  pushing: 'pending',
  live: 'on',
  offline: '',
  error: '',
} as const;

/** A saved board as the menu shows it: its ID, and the display it was last mirrored from. */
const label = (d: SavedDevice) => (d.displayName ? `${d.id} · ${d.displayName.replace(/^Waveshare /, '')}` : d.id);

/**
 * Run the open app on a real Resident device, driven by this bench's virtual inputs. Boards the relay
 * has reached are kept in a menu, so picking one replaces typing its ID.
 */
export function RemotePanel({ device, board, app, source, onShow, tz }: Props) {
  useSyncExternalStore(remote.subscribe, remote.getVersion);
  const [draft, setDraft] = useState(remote.deviceId);
  const active = remote.active;
  const saved = remote.saved;
  const picked = saved.find((d) => d.id === draft.trim());
  const pick = (id: string) => {
    setDraft(id);
    if (id) remote.setDeviceId(id);
  };
  return (
    <Panel
      id="remote"
      title="Real device"
      className="resident-panel"
      extra={
        active ? (
          <span className={`status ${STATUS[remote.status]}`}>
            <span className={`led ${remote.status === 'live' ? 'on' : ''}`} /> {remote.status === 'live' ? 'mirroring' : remote.status}
          </span>
        ) : undefined
      }
    >
      <p className="hint">Mirror this app onto a real Resident board, driven by this bench.</p>
      {saved.length > 0 && (
        <div className="row">
          <select className="grow" value={picked ? picked.id : ''} disabled={active} onChange={(e) => pick(e.target.value)} aria-label="Real device">
            {saved.map((d) => (
              <option key={d.id} value={d.id}>
                {label(d)}
              </option>
            ))}
            <option value="">+ Another board…</option>
          </select>
          {picked && !active && (
            <button
              className="link"
              title={`Take ${picked.id} off this list`}
              onClick={() => {
                remote.forget(picked.id);
                if (remote.saved.length) pick(remote.saved[0].id);
              }}
            >
              Forget
            </button>
          )}
        </div>
      )}
      {!picked && (
        <div className="row">
          <input
            className="text grow mono"
            value={draft}
            placeholder="the device's ID"
            spellCheck={false}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => remote.setDeviceId(draft)}
            aria-label="Real device ID"
          />
        </div>
      )}
      {picked?.display && picked.display !== device.id && (
        <p className="hint">
          Last used with {picked.displayName?.replace(/^Waveshare /, '')}.{' '}
          {findDevice(picked.display) && !active && (
            <button className="link" onClick={() => onShow(picked.display!)}>
              Show it
            </button>
          )}
        </p>
      )}
      <div className="row">
        {active ? (
          <button onClick={() => remote.stop()}>Stop</button>
        ) : (
          <button
            disabled={!draft.trim()}
            onClick={() => {
              remote.setDeviceId(draft);
              void remote.start(app, source, { display: { id: device.id, name: device.name }, tz });
            }}
          >
            Mirror
          </button>
        )}
      </div>
      {remote.message && <p className={`hint ${remote.status === 'error' || remote.status === 'offline' ? 'warn' : ''}`}>{remote.message}</p>}
      {active && remote.status === 'live' && <p className="hint">{remote.sent} updates sent. Switching apps here sends the new one.</p>}
      <div className="row">
        <Copy
          label="Copy a prompt to set up a board"
          done="Prompt copied"
          title={`Copy a prompt for Claude Code to build Resident firmware for ${device.name} and flash it, so it gets a device ID`}
          text={() => firmwarePrompt(device, board)}
        />
      </div>
    </Panel>
  );
}
