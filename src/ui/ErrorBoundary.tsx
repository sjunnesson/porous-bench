import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** What shows instead of the children once they threw (default: nothing). */
  fallback?(error: unknown): ReactNode;
  onError?(error: unknown): void;
}

/** Keeps one part's failure from blanking the whole page: React unmounts everything above an uncaught error. */
export class ErrorBoundary extends Component<Props, { error: unknown }> {
  state = { error: undefined as unknown };

  static getDerivedStateFromError(error: unknown) {
    return { error: error ?? new Error('unknown error') };
  }

  componentDidCatch(error: unknown) {
    this.props.onError?.(error);
  }

  render() {
    if (this.state.error === undefined) return this.props.children;
    return this.props.fallback?.(this.state.error) ?? null;
  }
}

/** Forget everything Bench saved in this browser (desk, app, settings) and start over. */
export function resetBench(): void {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith('bench:')) localStorage.removeItem(k);
  } catch {
    /* storage unavailable: nothing saved to clear */
  }
  location.reload();
}

/** The whole page, when the app itself failed to render. */
export function Crashed({ error }: { error: unknown }) {
  return (
    <div className="crashed">
      <p className="about-kicker">porous.systems bench</p>
      <h2>Bench stopped with an error</h2>
      <pre>{error instanceof Error ? error.message : String(error)}</pre>
      <p>
        Reload to try again. If it happens every time, something Bench saved in this browser may be the cause: Reset
        Bench clears all of it (your desk, the app you ran last, your settings and device IDs) and starts fresh.
      </p>
      <div className="crashed-actions">
        <button onClick={() => location.reload()}>Reload</button>
        <button onClick={resetBench}>Reset Bench</button>
        <a href="https://github.com/sjunnesson/porous-bench/issues" target="_blank" rel="noreferrer">
          Report it
        </a>
      </div>
    </div>
  );
}
