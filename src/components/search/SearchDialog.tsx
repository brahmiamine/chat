import { useEffect, useMemo, useRef, useState } from 'react';
import type { Conversation } from '../../types';
import { fmtDate, normalize } from '../../lib/chat';
import { SearchIcon } from '../ui/Icons';

interface Props {
  conversations: Conversation[];
  onOpen: (id: string) => void;
  onClose: () => void;
}

interface Result { c: Conversation; snippet: string }

function search(list: Conversation[], raw: string): Result[] {
  const q = normalize(raw.trim());
  const sorted = [...list].sort((a, b) => b.updatedAt - a.updatedAt);
  if (!q) return sorted.slice(0, 8).map(c => ({ c, snippet: '' }));
  const res: Result[] = [];
  for (const c of sorted) {
    if (normalize(c.title).includes(q)) { res.push({ c, snippet: '' }); continue; }
    for (const m of c.messages) {
      const i = normalize(m.content).indexOf(q);
      if (i >= 0) {
        const st = Math.max(0, i - 30);
        res.push({ c, snippet: (st > 0 ? '…' : '') + m.content.slice(st, i + q.length + 70).replace(/\s+/g, ' ') });
        break;
      }
    }
    if (res.length >= 20) break;
  }
  return res;
}

export function SearchDialog({ conversations, onOpen, onClose }: Props) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const results = useMemo(() => search(conversations, q), [conversations, q]);
  const idx = Math.min(sel, Math.max(0, results.length - 1));

  useEffect(() => { input.current?.focus(); }, []);

  return (
    <div className="overlay search-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="search-box" role="dialog" aria-modal="true" aria-label="Rechercher">
        <div className="search-head">
          <SearchIcon />
          <input
            ref={input}
            value={q}
            placeholder="Rechercher une conversation…"
            aria-label="Rechercher une conversation"
            onChange={e => { setQ(e.target.value); setSel(0); }}
            onKeyDown={e => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setSel(Math.min(idx + 1, results.length - 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(Math.max(idx - 1, 0)); }
              else if (e.key === 'Enter' && results[idx]) { e.preventDefault(); onOpen(results[idx].c.id); }
            }}
          />
          <span className="kbd-tag">Échap</span>
        </div>
        <div className="search-list">
          {results.map((r, i) => (
            <button key={r.c.id} className={`search-item${i === idx ? ' sel' : ''}`} onClick={() => onOpen(r.c.id)} onMouseEnter={() => i !== idx && setSel(i)}>
              <div className="row"><span className="t">{r.c.title}</span><span className="d">{fmtDate(r.c.updatedAt)}</span></div>
              {r.snippet && <span className="s">{r.snippet}</span>}
            </button>
          ))}
          {results.length === 0 && (
            <div className="search-empty">{conversations.length ? 'Aucun résultat' : 'Aucune conversation pour l’instant'}</div>
          )}
        </div>
      </div>
    </div>
  );
}
