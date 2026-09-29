import { memo } from 'react';
import { highlightToHtml, languageLabel } from '../../lib/highlight';
import { useCopy } from '../../hooks/useCopy';
import { CheckIcon, CopyIcon } from '../ui/Icons';

export const CodeBlock = memo(function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const { copied, copy } = useCopy();
  return (
    <div className="code-block">
      <div className="code-head">
        <span className="lang">{languageLabel(lang)}</span>
        <button className="code-copy ghost" onClick={() => copy(code)}>
          {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
          {copied ? 'Copié' : 'Copier'}
        </button>
      </div>
      <pre>
        <code dangerouslySetInnerHTML={{ __html: highlightToHtml(code, lang) }} />
      </pre>
    </div>
  );
});
