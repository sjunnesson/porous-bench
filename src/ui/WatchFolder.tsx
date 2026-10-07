import { useSyncExternalStore } from 'react';
import { folderWatch } from '../resident/watch';

/** Watch a folder for .lua files: what Claude Code (or an editor) saves there runs here. */
export function WatchFolder() {
  useSyncExternalStore(folderWatch.subscribe, folderWatch.getVersion);
  if (!folderWatch.supported) {
    return <p className="dim small">Watching a folder for apps needs Chrome or Edge; you can still drop a .lua file on the device.</p>;
  }
  const { folder, saved, last, error } = folderWatch;
  return (
    <>
      <div className="row">
        {folder ? (
          <>
            <span className="small">
              Watching <code>{folder.name}/</code>&nbsp;·&nbsp;
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
            <button className="link" onClick={() => folderWatch.stop()}>
              forget
            </button>
          </>
        ) : (
          <button className="link" onClick={() => void folderWatch.pick()} title="Pick the folder you run Claude Code in: every .lua saved there runs here">
            Watch a folder for apps
          </button>
        )}
      </div>
      {folder && <p className="dim small">{last ? `Running ${last}. ` : ''}Save a .lua file in it and it runs here.</p>}
      {error && <p className="warn small">{error}</p>}
    </>
  );
}
