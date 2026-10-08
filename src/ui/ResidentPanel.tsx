import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { session } from '../resident/session';
import { Copy } from './Copy';
import { Panel } from './Panel';

const STATUS = {
  off: { label: 'offline', cls: '' },
  connecting: { label: 'connecting…', cls: 'pending' },
  retrying: { label: 'reconnecting…', cls: 'pending' },
  online: { label: 'online', cls: 'on' },
} as const;

interface Props {
  /** Source of the Resident app running now (null when the sketch isn't a Resident app). */
  code: string | null;
  appName: string | null;
}

export function ResidentPanel({ code, appName }: Props) {
  useSyncExternalStore(session.subscribe, session.getVersion);
  const [draft, setDraft] = useState(code ?? '');
  const [eventName, setEventName] = useState('note');
  const [eventData, setEventData] = useState('{ "text": "hello" }');
  const [eventError, setEventError] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  useEffect(() => setDraft(code ?? ''), [code]);

  const st = STATUS[session.status];
  const id = session.deviceId;
  const curl = `curl -X POST ${session.relay.pushUrl} -H 'Content-Type: application/json' -d '{"type":"app","code":"function init(ctx) screen.text(10,10,\\"hi\\") screen.flip() end"}'`;

  const sendEvent = () => {
    try {
      const data = eventData.trim() ? JSON.parse(eventData) : {};
      if (!session.host) return setEventError('No Resident app is running.');
      const ok = session.host.queue({ name: eventName, data, from: 'bench', channel: 'app' });
      setEventError(ok ? null : 'Dropped: the app defines no on_event, or data is over 1024 bytes.');
    } catch (err) {
      setEventError(`Data isn't valid JSON: ${(err as Error).message}`);
    }
  };

  return (
    <Panel
      id="resident"
      title="Resident"
      className="resident-panel"
      extra={
        <span className={`status ${st.cls}`}>
          <span className={`led ${st.cls === 'on' ? 'on' : ''}`} /> {st.label}
        </span>
      }
    >

      <div className="row">
        <span className="dim">Device ID</span>
        <code className="device-id">{id}</code>
        <Copy text={id} />
        <button className="link" onClick={() => session.newId()} title="Generate a new random ID">
          new
        </button>
      </div>
      <div className="row">
        <span className="dim">Relay</span>
        <span className="small">{session.relay.host}</span>
      </div>
      <div className="row">
        {session.status === 'off' ? (
          <button onClick={() => session.connect()}>Connect to relay</button>
        ) : (
          <button onClick={() => session.disconnect()}>Disconnect</button>
        )}
      </div>

      {session.status !== 'off' && (
        <div className="push-help">
          <p className="dim small">Push apps here like to a real device. With the Resident Claude Code plugin:</p>
          <pre>
            RESIDENT_DEVICE_ID={id}
            {'\n'}/resident:push-app give me a lil guy <Copy text={`RESIDENT_DEVICE_ID=${id}`} label="copy id" />
          </pre>
          <p className="dim small">
            or curl <Copy text={curl} />
          </p>
        </div>
      )}
      <p className="dim small">
        Time zone: {session.zone.name} {session.zoneFromHost ? '(from host hello)' : '(browser)'}
      </p>

      {code !== null && (
        <>
          <h3>
            {appName} <span className="dim small">· edit and run</span>
          </h3>
          <textarea
            className="code"
            spellCheck={false}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') session.setLive({ name: `${appName ?? 'App'} (edited)`, code: draft, source: 'editor' });
            }}
          />
          <div className="row">
            <button onClick={() => session.setLive({ name: `${appName ?? 'App'} (edited)`, code: draft, source: 'editor' })}>Run ⌘↵</button>
            <button onClick={() => picker.current?.click()} title="Run a .lua file from this computer, as if dropped on the device">
              Open .lua…
            </button>
            <input
              ref={picker}
              type="file"
              accept=".lua"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                // Cleared so picking the same file again (after editing it) runs it again.
                e.target.value = '';
                if (file) void file.text().then((code) => session.setLive({ name: file.name.replace(/\.lua$/, ''), code, source: 'file' }));
              }}
            />
            <span className="dim small">or drop one on the device</span>
          </div>

          <h3>Send event</h3>
          <div className="row">
            <input className="text" value={eventName} onChange={(e) => setEventName(e.target.value)} aria-label="Event name" />
            <input className="text grow mono" value={eventData} onChange={(e) => setEventData(e.target.value)} aria-label="Event data (JSON)" />
            <button onClick={sendEvent}>Send</button>
          </div>
          {eventError && <p className="warn small">{eventError}</p>}
        </>
      )}
    </Panel>
  );
}
