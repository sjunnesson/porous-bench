import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { errorKind, startAnalytics, track } from './analytics';
import { migrateStorage } from './migrate';
import { openShared } from './share';
import { Crashed, ErrorBoundary } from './ui/ErrorBoundary';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans-condensed/500.css';
import '@fontsource/ibm-plex-sans-condensed/600.css';
// LVGL's built-in fonts are Montserrat Medium; Bench's lvgl renders with the same face.
import '@fontsource/montserrat/500.css';
import '@fontsource/montserrat/700.css';
import './styles.css';

// Page views and Bench's events (see analytics.ts), set up before a share link opens so its events
// are counted too. The query, the hash and a short link's id never leave: they could carry a device
// ID or open someone's app.
startAnalytics((url) => url.split(/[?#]/)[0].replace(/\/s\/[^/]*$/, '/s'));
addEventListener('error', (e) => track('crash', { where: 'page', kind: errorKind(e.error) }));
addEventListener('unhandledrejection', (e) => track('crash', { where: 'promise', kind: errorKind(e.reason) }));

migrateStorage();

// A share link's setup is written before the first render, where App reads its own.
void openShared().then((shared) =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ErrorBoundary fallback={(error) => <Crashed error={error} />} onError={(error) => track('crash', { where: 'app', kind: errorKind(error) })}>
        <App shared={shared} />
      </ErrorBoundary>
    </StrictMode>,
  ),
);
