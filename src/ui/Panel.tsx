import type { ReactNode } from 'react';
import { usePersisted } from './hooks';

/**
 * A sidebar section whose header folds it away. Open or closed is remembered per section; the body
 * stays mounted while folded, so drafts and scroll positions survive.
 */
export function Panel({
  id,
  title,
  extra,
  className,
  children,
}: {
  id: string;
  title: ReactNode;
  /** Header content on the right (a status, a small action); stays visible when folded. */
  extra?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = usePersisted(`panel:${id}`, true);
  return (
    <section className={`panel ${className ?? ''} ${open ? '' : 'collapsed'}`}>
      <h2>
        <button className="panel-toggle" aria-expanded={open} aria-controls={`panel-${id}`} onClick={() => setOpen(!open)}>
          <span className="chevron" aria-hidden="true" />
          {title}
        </button>
        {extra}
      </h2>
      <div className="panel-body" id={`panel-${id}`} hidden={!open}>
        {children}
      </div>
    </section>
  );
}
