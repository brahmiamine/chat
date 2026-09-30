import { useEffect, useRef } from 'react';
import { PREVIEW_MESSAGE_KEY, PREVIEW_SANDBOX, type PreviewConsoleEntry } from '../../lib/preview';

export const isDarkTheme = () => typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark';

interface Props {
  doc: string;
  /** CSS width of the page (responsive preview), e.g. 390 or '100%'. */
  width?: number | string;
  title?: string;
  onConsole?: (entry: PreviewConsoleEntry) => void;
}

/**
 * Sandboxed iframe (no allow-same-origin: opaque origin, no access to the
 * app's storage). Console messages are accepted only from this iframe.
 */
export function PreviewFrame({ doc, width = '100%', title = 'Aperçu', onConsole }: Props) {
  const ref = useRef<HTMLIFrameElement>(null);
  const handler = useRef(onConsole);
  handler.current = onConsole;

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (!ref.current || e.source !== ref.current.contentWindow) return;
      const data = e.data;
      if (!data || typeof data !== 'object' || data[PREVIEW_MESSAGE_KEY] !== 1) return;
      const level = ['log', 'info', 'warn', 'error', 'debug'].includes(data.level) ? data.level : 'log';
      handler.current?.({ level, text: String(data.text ?? '').slice(0, 5000) });
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  return (
    <div className="preview-stage">
      <iframe
        ref={ref}
        className="preview-frame"
        title={title}
        sandbox={PREVIEW_SANDBOX}
        referrerPolicy="no-referrer"
        srcDoc={doc}
        style={{ width: typeof width === 'number' ? `${width}px` : width }}
      />
    </div>
  );
}
