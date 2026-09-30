import { memo, useContext, useMemo, useState } from 'react';
import type { ArtifactFile } from '../../types';
import { highlightToHtml, languageLabel } from '../../lib/highlight';
import { defaultFileName, extensionOf, hasPreview, kindOf, mimeOf } from '../../lib/artifacts';
import { downloadText } from '../../lib/download';
import { useCopy } from '../../hooks/useCopy';
import { CheckIcon, CopyIcon, DownloadIcon } from '../ui/Icons';
import { ArtifactPreview } from '../artifact/ArtifactPreview';
import { MessageCode } from '../artifact/context';

export const CodeBlock = memo(function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const { copied, copy } = useCopy();
  const [view, setView] = useState<'code' | 'preview'>('code');
  const { fences, onFix } = useContext(MessageCode);
  const kind = kindOf(lang, code);
  const previewable = hasPreview(kind);
  const fileName = defaultFileName(lang, kind);

  // An HTML page is previewed together with the CSS/JS blocks of the same answer.
  const files = useMemo<ArtifactFile[]>(() => {
    const main = { name: fileName, lang, code };
    if (kind !== 'html' && kind !== 'react') return [main];
    const siblings = fences
      .filter(f => f.complete && f.code !== code)
      .filter(f => extensionOf(f.lang) === 'css' || (kind === 'html' && extensionOf(f.lang) === 'js'))
      .map(f => ({ name: extensionOf(f.lang) === 'css' ? 'style.css' : 'script.js', lang: f.lang, code: f.code }));
    return [main, ...siblings];
  }, [code, lang, kind, fileName, fences]);

  const fix = onFix
    ? (errors: string[]) => onFix(
      `Le code ${languageLabel(lang)} ci-dessus produit ces erreurs dans l’aperçu. Corrige-le et renvoie le code complet :\n\`\`\`\n${errors.join('\n')}\n\`\`\``,
    )
    : undefined;

  return (
    <div className={`code-block${view === 'preview' ? ' previewing' : ''}`}>
      <div className="code-head">
        <span className="lang">{languageLabel(lang)}</span>
        <div className="code-actions">
          {previewable && (
            <div className="code-tabs" role="tablist">
              <button role="tab" aria-selected={view === 'code'} className={view === 'code' ? 'on' : ''} onClick={() => setView('code')}>Code</button>
              <button role="tab" aria-selected={view === 'preview'} className={view === 'preview' ? 'on' : ''} onClick={() => setView('preview')}>
                {kind === 'javascript' ? '▶ Exécuter' : 'Aperçu'}
              </button>
            </div>
          )}
          <button className="code-copy ghost" aria-label="Télécharger" title={`Télécharger ${fileName}`} onClick={() => downloadText(fileName, code, mimeOf(fileName))}>
            <DownloadIcon size={14} />
          </button>
          <button className={`code-copy ghost${copied ? ' done' : ''}`} onClick={() => copy(code)}>
            {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
            {copied ? 'Copié' : 'Copier'}
          </button>
        </div>
      </div>
      {view === 'code' || !previewable
        ? <pre><code dangerouslySetInnerHTML={{ __html: highlightToHtml(code, lang) }} /></pre>
        : <ArtifactPreview kind={kind} files={files} onFix={fix} className="inline" />}
    </div>
  );
});
