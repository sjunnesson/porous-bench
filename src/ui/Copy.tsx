import { useState } from 'react';

/** A link (or, with `className`, a button) that copies text to the clipboard (`text` can be built at click time) and says so. */
export function Copy({ text, label = 'copy', done = 'copied', title, className = 'link' }: { text: string | (() => string); label?: string; done?: string; title?: string; className?: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const show = (s: typeof state) => {
    setState(s);
    setTimeout(() => setState('idle'), 1400);
  };
  return (
    <button
      className={className}
      title={title}
      onClick={() => {
        const value = typeof text === 'function' ? text() : text;
        if (!navigator.clipboard) return show('failed');
        navigator.clipboard.writeText(value).then(() => show('copied'), () => show('failed'));
      }}
    >
      {state === 'copied' ? done : state === 'failed' ? "couldn't copy" : label}
    </button>
  );
}
