import { useSyncExternalStore } from 'react';
import { session } from '../resident/session';
import { Copy } from './Copy';
import { Panel } from './Panel';
import { WatchFolder } from './WatchFolder';

const STATUS = {
  off: { label: 'offline', cls: '' },
  connecting: { label: 'connecting…', cls: 'pending' },
  retrying: { label: 'reconnecting…', cls: 'pending' },
  online: { label: 'online', cls: 'on' },
} as const;

/**
 * Where apps come in from outside Bench, one row per way in: pushed over Resident's relay to this
 * Bench's device ID (the way they reach a real board), or saved in a folder Bench watches.
 */
export function ResidentPanel() {
  useSyncExternalStore(session.subscribe, session.getVersion);
  const st = STATUS[session.status];
  const id = session.deviceId;
  const pushApp = `/resident:push-app --device-id ${id} `;

  return (
    <Panel
      id="resident"
      title="Receive apps"
      className="resident-panel"
      extra={
        <span className={`status ${st.cls}`} title={`Resident relay: ${session.relay.host}`}>
          <span className={`led ${st.cls === 'on' ? 'on' : ''}`} /> {st.label}
        </span>
      }
    >
      <h3>Relay</h3>
      <div className="row nowrap id">
        <code className="device-id" title="This Bench's device ID: apps pushed to it over Resident's relay run here">
          {id}
        </code>
        {session.status === 'off' ? (
          <button onClick={() => session.connect()}>Connect</button>
        ) : (
          <button onClick={() => session.disconnect()}>Disconnect</button>
        )}
      </div>
      <div className="row">
        <Copy text={id} label="Copy ID" done="ID copied" title="Copy this Bench's device ID" />
        <span className="sep" aria-hidden="true">
          ·
        </span>
        <Copy
          text={pushApp}
          label="Copy push-app"
          done="Command copied"
          title={`Copy "${pushApp}" for Claude Code with the Resident plugin: follow it with an app idea or a .lua file`}
        />
        <span className="sep" aria-hidden="true">
          ·
        </span>
        <button className="link" onClick={() => session.newId()} title="Generate a new random device ID: anyone who knows the old one can no longer push here">
          New ID
        </button>
      </div>

      <h3>Folder</h3>
      <WatchFolder />
    </Panel>
  );
}
