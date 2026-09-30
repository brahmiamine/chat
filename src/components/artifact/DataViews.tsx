import { lazy, Suspense, useMemo } from 'react';

const Markdown = lazy(() => import('../chat/Markdown').then(m => ({ default: m.Markdown })));

// ---- JSON tree ----

function JsonNode({ name, value, depth }: { name?: string; value: unknown; depth: number }) {
  const label = name !== undefined ? <span className="jt-key">{name}: </span> : null;
  if (value === null || typeof value !== 'object') {
    const cls = value === null ? 'jt-null' : `jt-${typeof value}`;
    return <div className="jt-row">{label}<span className={cls}>{JSON.stringify(value)}</span></div>;
  }
  const entries = Array.isArray(value) ? value.map((v, i) => [String(i), v] as const) : Object.entries(value as object);
  const summary = Array.isArray(value) ? `[${entries.length}]` : `{${entries.length}}`;
  return (
    <details className="jt-node" open={depth < 2}>
      <summary>{label}<span className="jt-summary">{summary}</span></summary>
      <div className="jt-children">
        {entries.slice(0, 500).map(([k, v]) => <JsonNode key={k} name={k} value={v} depth={depth + 1} />)}
        {entries.length > 500 && <div className="jt-row jt-more">… {entries.length - 500} éléments de plus</div>}
      </div>
    </details>
  );
}

export function JsonView({ code }: { code: string }) {
  const parsed = useMemo(() => {
    try { return { ok: true as const, value: JSON.parse(code) as unknown }; } catch (e) { return { ok: false as const, error: (e as Error).message }; }
  }, [code]);
  if (!parsed.ok) return <div className="data-error">JSON invalide : {parsed.error}</div>;
  return <div className="json-tree"><JsonNode value={parsed.value} depth={0} /></div>;
}

// ---- CSV table ----

export function parseCsv(text: string): string[][] {
  const first = text.split('\n', 1)[0] || '';
  const delimiter = [',', ';', '\t', '|'].reduce((best, d) => (first.split(d).length > first.split(best).length ? d : best), ',');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && !field) quoted = true;
    else if (c === delimiter) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(x => x !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some(x => x !== '')) rows.push(row);
  return rows;
}

export function CsvView({ code }: { code: string }) {
  const rows = useMemo(() => parseCsv(code), [code]);
  if (!rows.length) return <div className="data-error">CSV vide</div>;
  const [head, ...body] = rows;
  return (
    <div className="csv-wrap">
      <table className="csv-table">
        <thead><tr>{head.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
        <tbody>
          {body.slice(0, 1000).map((r, i) => <tr key={i}>{head.map((_, j) => <td key={j}>{r[j] ?? ''}</td>)}</tr>)}
        </tbody>
      </table>
      <div className="csv-count">{body.length} ligne{body.length > 1 ? 's' : ''}{body.length > 1000 ? ' (1000 affichées)' : ''}</div>
    </div>
  );
}

export function MarkdownView({ code }: { code: string }) {
  return (
    <div className="md-preview">
      <Suspense fallback={<pre>{code}</pre>}><Markdown text={code} /></Suspense>
    </div>
  );
}
