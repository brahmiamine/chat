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

// Warm the Markdown/highlighting chunk once the UI is interactive.
const idle = window.requestIdleCallback || ((cb: () => void) => setTimeout(cb, 300));
idle(() => { loadMarkdown(); });
