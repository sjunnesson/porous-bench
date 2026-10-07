import { useState, useSyncExternalStore } from 'react';
import { firmwarePrompt } from '../resident/firmware';
import { type MirrorSource, remote } from '../resident/remote';
import type { Board } from '../sim/boards';
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
}

const STATUS = {
  off: '',
  pushing: 'pending',
  live: 'on',
  offline: '',
  error: '',
} as const;

/** Run the open app on a real Resident device, driven by this bench's virtual inputs. */
export function RemotePanel({ device, board, app, source }: Props) {
  useSyncExternalStore(remote.subscribe, remote.getVersion);
  const [draft, setDraft] = useState(remote.deviceId);
  const active = remote.active;
  return (
    <Panel
      id="remote"
      title="Real device"
      extra={
        active ? (
          <span className={`status ${STATUS[remote.status]}`}>
            <span className={`led ${remote.status === 'live' ? 'on' : ''}`} /> {remote.status === 'live' ? 'mirroring' : remote.status}
          </span>
        ) : undefined
      }
    >
      <p className="dim small">
        Run this app on a Resident device on your desk, driven by the inputs on this bench: turn the virtual encoder, wave at the
        virtual PIR, and the real display follows. No Resident firmware on it yet? The firmware prompt gets it there.
      </p>
      <div className="row">
        <Copy
          label="Copy firmware prompt"
          done="Firmware prompt copied"
          title={`Copy a prompt for Claude Code to build Resident firmware for ${device.name} and flash it, so it gets a device ID`}
          text={() => firmwarePrompt(device, board)}
        />
      </div>
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
        {active ? (
          <button onClick={() => remote.stop()}>Stop</button>
        ) : (
          <button
            disabled={!draft.trim()}
            onClick={() => {
              remote.setDeviceId(draft);
              void remote.start(app, source);
            }}
          >
            Mirror
          </button>
        )}
      </div>
      {remote.message && <p className={`small ${remote.status === 'error' || remote.status === 'offline' ? 'warn' : 'dim'}`}>{remote.message}</p>}
      {active && remote.status === 'live' && <p className="dim small">{remote.sent} updates sent. Switching apps here sends the new one.</p>}
    </Panel>
  );
}
