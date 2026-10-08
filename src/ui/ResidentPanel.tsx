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
 * Where apps come in from outside Bench: pushed over Resident's relay to this Bench's device ID, the
 * way they reach a real board, or saved in a folder Bench watches.
 */
export function ResidentPanel() {
  useSyncExternalStore(session.subscribe, session.getVersion);
  const st = STATUS[session.status];
  const id = session.deviceId;
  const pushApp = `/resident:push-app --device-id ${id} `;
  const nowrap = { whiteSpace: 'nowrap' } as const;
  const curl = `curl -X POST ${session.relay.pushUrl} -H 'Content-Type: application/json' -d '{"type":"app","code":"function init(ctx) screen.text(10,10,\\"hi\\") screen.flip() end"}'`;

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
      <p className="hint">Bench is a Resident device too: apps pushed to its ID run here.</p>
      <div className="row">
        <span className="label">Device ID</span>
        <code className="device-id">{id}</code>
        <Copy text={id} />
        <button className="link" onClick={() => session.newId()} title="Generate a new random ID">
          new
        </button>
      </div>
      <div className="row">
        {session.status === 'off' ? (
          <button onClick={() => session.connect()}>Connect to relay</button>
        ) : (
          <button onClick={() => session.disconnect()}>Disconnect</button>
        )}
      </div>
      {session.status !== 'off' && (
        <>
          <p className="hint">From Claude Code, with the Resident plugin:</p>
          <pre className="command">
            /resident:push-app <span style={nowrap}>--device-id {id}</span> <span className="dim">an app idea or a .lua file</span>
          </pre>
          <div className="row">
            <Copy text={pushApp} label="copy command" />
            <Copy text={curl} label="copy as curl" />
          </div>
        </>
      )}

      <h3>From a folder on this computer</h3>
      <WatchFolder />
    </Panel>
  );
}
