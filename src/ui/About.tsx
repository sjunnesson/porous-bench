import { useRef } from 'react';

/** The About button and the dialog it opens: what Bench is, and the work it stands on. */
export function About() {
  const dialog = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button onClick={() => dialog.current?.showModal()} title="What Bench is, and who it builds on">
        About
      </button>
      <dialog
        ref={dialog}
        className="about"
        aria-labelledby="about-title"
        // A click on the backdrop lands on the dialog itself (the content fills it): close.
        onClick={(e) => e.target === dialog.current && dialog.current.close()}
      >
        <div className="about-body">
          <form method="dialog" className="about-close">
            <button className="link">Close</button>
          </form>
          <p className="about-kicker">porous.systems</p>
          <h2 id="about-title">Bench</h2>
          <p>
            ESP32 displays, LED chains and the parts you wire to them, on a desk in your browser. Your Lua app runs at the
            real hardware's pace; when it's right, push it to a board or mirror it onto one.
          </p>

          <h3>Built on Resident, by Inanimate</h3>
          <p>
            The apps Bench runs are{' '}
            <a href="https://github.com/inanimate-tech/resident" target="_blank" rel="noreferrer">
              Resident
            </a>{' '}
            apps. Resident is{' '}
            <a href="https://inanimate.tech" target="_blank" rel="noreferrer">
              Inanimate
            </a>
            's sandboxed Lua runtime for ESP32 devices, with hot reload over the air. The runtime and its Lua API, the relay
            that carries pushed apps and the mirror to your board, and the Claude Code plugin that writes and pushes apps are
            all their work. Several of the example apps come from Resident's own. Bench recreates the runtime in the browser,
            so one app runs the same here and on the board.
          </p>

          <p className="about-foot">
            Bench is open source under the MIT license, and so is Resident. This site counts page views with Vercel Web
            Analytics: no cookies, and nothing about your apps or your bench.
            <span className="about-links">
              <a href="https://github.com/sjunnesson/porous-bench" target="_blank" rel="noreferrer">
                Bench on GitHub
              </a>
              <a href="https://github.com/sjunnesson/porous-bench/blob/main/THIRD_PARTY_NOTICES.md" target="_blank" rel="noreferrer">
                Third-party notices
              </a>
            </span>
          </p>
        </div>
      </dialog>
    </>
  );
}
