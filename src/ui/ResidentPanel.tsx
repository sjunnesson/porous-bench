import { useEffect, useState, useSyncExternalStore } from 'react';
import { session } from '../resident/session';

const STATUS = {
  off: { label: 'offline', cls: '' },
  connecting: { label: 'connecting…', cls: 'pending' },
  retrying: { label: 'reconnecting…', cls: 'pending' },
  online: { label: 'online', cls: 'on' },
} as const;

function Copy({ text, label = 'copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="link"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        });
      }}
    >
      {done ? 'copied' : label}
    </button>
  );
}

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
  useEffect(() => setDraft(code ?? ''), [code]);

  const st = STATUS[session.status];
  const id = session.deviceId;
  const curl = `curl -X POST ${session.relay.pushUrl} -H 'Content-Type: application/json' -d '{"type":"app","code":"function init(ctx) screen.text(10,10,\\"hi\\") screen.flip() end"}'`;

  const sendEvent = () => {
    try {
      const data = eventData.trim() ? JSON.parse(eventData) : {};
      if (!session.host) return setEventError('No Resident app is running.');
      const ok = session.host.queue({ name: eventName, data, from: 'screensim', channel: 'app' });
      setEventError(ok ? null : 'Dropped: the app defines no on_event, or data is over 1024 bytes.');
    } catch (err) {
      setEventError(`Data isn't valid JSON: ${(err as Error).message}`);
    }
  };

  return (
    <div className="panel resident-panel">
      <h2>
        Resident
        <span className={`status ${st.cls}`}>
          <span className={`led ${st.cls === 'on' ? 'on' : ''}`} /> {st.label}
        </span>
      </h2>

      <div className="row">
        <span className="dim">Device ID</span>
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
        <span className="dim small">{session.relay.host}</span>
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
            <span className="dim small">or drop a .lua file on the device</span>
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
    </div>
  );
}
