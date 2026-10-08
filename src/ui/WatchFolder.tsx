import { useSyncExternalStore } from 'react';
import { folderWatch } from '../resident/watch';

/** Watch a folder for .lua files: what Claude Code (or an editor) saves there runs here. */
export function WatchFolder() {
  useSyncExternalStore(folderWatch.subscribe, folderWatch.getVersion);
  if (!folderWatch.supported) {
    return <p className="dim small">Watching a folder for apps needs Chrome or Edge; you can still drop a .lua file on the device.</p>;
  }
  const { folder, saved, mode, last, skill, refused, error } = folderWatch;
  return (
    <>
      <div className="row">
        {folder ? (
          <>
            <span className="small">
              Watching <code>{folder.name}/</code>
              {mode === 'read' ? ' read-only' : ''}&nbsp;·&nbsp;
            </span>
            <button className="link" onClick={() => folderWatch.stop()} title="Stop watching this folder">
              stop
            </button>
          </>
        ) : saved ? (
          <>
            <button className="link" onClick={() => void folderWatch.resume()} title="The browser asks again after a reload">
              Resume watching {saved.name}/
            </button>
            {refused && mode === 'readwrite' && (
              <>
                <Dot />
                <button className="link" onClick={() => void folderWatch.resume('read')} title="Watch it without letting Bench edit it">
                  read-only
                </button>
              </>
            )}
            <Dot />
            <button className="link" onClick={() => folderWatch.stop()}>
              forget
            </button>
          </>
        ) : (
          <>
            <button className="link" onClick={() => void folderWatch.pick()} title="Pick the folder you run Claude Code in: every .lua saved there runs here">
              Watch a folder for apps
            </button>
            {refused && (
              <>
                <Dot />
                <button className="link" onClick={() => void folderWatch.pick('read')} title="Watch a folder without letting Bench edit it">
                  read-only
                </button>
              </>
            )}
          </>
        )}
      </div>
      {folder && (
        <p className="dim small">
          {last ? `Running ${last}. ` : ''}Save a .lua file in it and it runs here.
          {skill && (
            <>
              {' '}
              <code>DEVICE-SKILL.md</code> in it is this Bench's, for Claude.
            </>
          )}
          {mode === 'read' && (
            <>
              {' '}
              Read-only, so Claude downloads Bench's <code>DEVICE-SKILL.md</code> itself.{' '}
              <button className="link" onClick={() => void folderWatch.allowEdit()} title="Let Bench write its device skill into this folder">
                Let Bench put it here
              </button>
            </>
          )}
        </p>
      )}
      {refused && !folder && (
        <p className="dim small">
          Bench asks to edit the folder so it can put its <code>DEVICE-SKILL.md</code> there for Claude. To skip that, watch it read-only.
        </p>
      )}
      {error && <p className="warn small">{error}</p>}
    </>
  );
}

const Dot = () => <span className="small">&nbsp;·&nbsp;</span>;
