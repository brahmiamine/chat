import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ArtifactFile, ArtifactKind } from '../../types';
import type { PreviewConsoleEntry } from '../../lib/preview';
import { frameDocument, isFrameKind } from '../../lib/artifacts';
import { MonitorIcon, RefreshIcon } from '../ui/Icons';
import { CsvView, JsonView, MarkdownView } from './DataViews';
import { isDarkTheme, PreviewFrame } from './PreviewFrame';

type Size = 'mobile' | 'tablet' | 'desktop';
const WIDTHS: Record<Size, number | string> = { mobile: 390, tablet: 768, desktop: '100%' };
const SIZE_LABEL: Record<Size, string> = { mobile: 'Mobile', tablet: 'Tablette', desktop: 'Bureau' };

interface Props {
  kind: ArtifactKind;
  files: ArtifactFile[];
  /** Show Mobile / Tablet / Desktop widths (useful on wide screens). */
  sizes?: boolean;
  /** Called with the console errors when the user asks to fix them. */
  onFix?: (errors: string[]) => void;
  className?: string;
}

export function ArtifactPreview({ kind, files, sizes = false, onFix, className = '' }: Props) {
  const [size, setSize] = useState<Size>('desktop');
  const [reload, setReload] = useState(0);
  const [entries, setEntries] = useState<PreviewConsoleEntry[]>([]);
  const [consoleOpen, setConsoleOpen] = useState(kind === 'javascript');
  const dark = isDarkTheme();
  const doc = useMemo(() => (isFrameKind(kind) ? frameDocument(kind, files, dark) : ''), [kind, files, dark]);

  // New code or manual reload: fresh console.
  useEffect(() => { setEntries([]); }, [doc, reload]);
  const onConsole = useCallback((e: PreviewConsoleEntry) => {
    setEntries(list => (list.length > 300 ? list : [...list, e]));
    if (e.level === 'error') setConsoleOpen(true);
  }, []);

  if (!isFrameKind(kind)) {
    const code = files[0]?.code || '';
    return (
      <div className={`artifact-preview data ${className}`}>
        {kind === 'json' && <JsonView code={code} />}
        {kind === 'csv' && <CsvView code={code} />}
        {kind === 'markdown' && <MarkdownView code={code} />}
      </div>
    );
  }

  const errors = entries.filter(e => e.level === 'error').map(e => e.text);
  return (
    <div className={`artifact-preview ${kind === 'javascript' ? 'run' : ''} ${className}`}>
      <div className="preview-bar">
        {sizes && kind !== 'javascript' && (
          <div className="preview-sizes" role="radiogroup" aria-label="Largeur de l’aperçu">
            {(Object.keys(WIDTHS) as Size[]).map(s => (
              <button key={s} role="radio" aria-checked={size === s} className={size === s ? 'on' : ''} onClick={() => setSize(s)}>
                {s === 'desktop' && <MonitorIcon size={13} />}{SIZE_LABEL[s]}
              </button>
            ))}
          </div>
        )}
        <button className="preview-btn" onClick={() => setReload(r => r + 1)} aria-label="Relancer l’aperçu">
          <RefreshIcon size={13} />{kind === 'javascript' ? 'Relancer' : 'Recharger'}
        </button>
      </div>
      {kind !== 'javascript' && <PreviewFrame key={reload} doc={doc} width={WIDTHS[size]} onConsole={onConsole} />}
      {kind === 'javascript' && <PreviewFrame key={reload} doc={doc} width={0} onConsole={onConsole} />}
      <div className={`preview-console${consoleOpen ? ' open' : ''}`}>
        <button className="console-head" onClick={() => setConsoleOpen(o => !o)} aria-expanded={consoleOpen}>
          <span>Console</span>
          {errors.length
            ? <span className="console-badge err">{errors.length} erreur{errors.length > 1 ? 's' : ''}</span>
            : <span className="console-badge ok">{entries.length ? `${entries.length} message${entries.length > 1 ? 's' : ''}` : 'Aucune erreur'}</span>}
        </button>
        {consoleOpen && (
          <div className="console-body">
            {!entries.length && <div className="console-empty">{kind === 'javascript' ? 'Aucune sortie.' : 'Rien dans la console.'}</div>}
            {entries.map((e, i) => <pre key={i} className={`console-line ${e.level}`}>{e.text}</pre>)}
            {!!errors.length && onFix && (
              <button className="btn-outline console-fix" onClick={() => onFix(errors)}>🛠️ Corriger ces erreurs</button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
