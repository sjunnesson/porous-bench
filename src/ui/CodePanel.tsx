import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { session } from '../resident/session';
import { Panel } from './Panel';

interface Props {
  /** Source of the Resident app running now. */
  code: string;
  appName: string;
}

/** The running app's Lua: edit and run it, open a file instead, or send it an event. */
export function CodePanel({ code, appName }: Props) {
  useSyncExternalStore(session.subscribe, session.getVersion);
  const [draft, setDraft] = useState(code);
  const [eventName, setEventName] = useState('note');
  const [eventData, setEventData] = useState('{ "text": "hello" }');
  const [eventError, setEventError] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  useEffect(() => setDraft(code), [code]);

  const run = () => session.setLive({ name: `${appName} (edited)`, code: draft, source: 'editor' });
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
    <Panel id="code" title="Code">
      <textarea
        className="code"
        spellCheck={false}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') run();
        }}
        aria-label={`${appName}'s code`}
      />
      <div className="row">
        <button onClick={run} title="Run the edited code (⌘↵)">
          Run ⌘↵
        </button>
        <button onClick={() => picker.current?.click()} title="Run a .lua file from this computer, as if dropped on the display">
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
      </div>
      <p className="hint">Or drop a .lua file on the display.</p>

      <h3>Send an event</h3>
      <div className="row nowrap">
        <input className="text name" value={eventName} onChange={(e) => setEventName(e.target.value)} aria-label="Event name" />
        <input className="text grow mono" value={eventData} onChange={(e) => setEventData(e.target.value)} aria-label="Event data (JSON)" />
        <button onClick={sendEvent}>Send</button>
      </div>
      {eventError && <p className="warn small">{eventError}</p>}
    </Panel>
  );
}
