import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { loadMarkdown } from './components/chat/Messages';
import './styles/global.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

requestAnimationFrame(() => {
  const splash = document.getElementById('app-splash');
  if (!splash) return;
  splash.classList.add('done');
  window.setTimeout(() => splash.remove(), 220);
});

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      // PWA support is optional; the chat keeps working if registration fails.
    });
  });
}

// Warm the Markdown/highlighting chunk once the UI is interactive.
const idle = window.requestIdleCallback || ((cb: () => void) => setTimeout(cb, 300));
idle(() => { loadMarkdown(); });
