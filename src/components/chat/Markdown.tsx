/**
 * Markdown renderer (GFM: tables, task lists, strikethrough, autolinks).
 *
 * For streaming performance the source is split into top-level blocks and each
 * block is memoized: while tokens arrive only the last block is re-parsed.
 */
import { memo, useMemo, type ComponentProps } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CodeBlock } from './CodeBlock';

const remarkPlugins = [remarkGfm];

const heading = (level: 1 | 2 | 3 | 4 | 5 | 6) => {
  // Markdown h1 renders as <h2> etc. — the page title level belongs to the app.
  const Tag = `h${Math.min(level + 1, 6)}` as 'h2';
  return ({ node: _n, ...props }: ComponentProps<'h2'> & { node?: unknown }) => <Tag className={`h${level}`} {...props} />;
};

const components: Components = {
  h1: heading(1), h2: heading(2), h3: heading(3), h4: heading(4), h5: heading(5), h6: heading(6),
  a: ({ node: _n, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
  table: ({ node: _n, ...props }) => (
    <div className="table-wrap">
      <table {...props} />
    </div>
  ),
  pre: ({ children }) => <>{children}</>,
  code: ({ node, className, children, ...props }) => {
    const match = /language-([\w+#.-]+)/.exec(className || '');
    const text = String(children ?? '');
    // Fenced / indented blocks are those whose position spans lines or that declare a language.
    const isBlock = !!match || (node?.position && node.position.start.line !== node.position.end.line) || text.endsWith('\n');
    if (!isBlock) return <code className={className} {...props}>{children}</code>;
    return <CodeBlock code={text.replace(/\n$/, '')} lang={match?.[1] || ''} />;
  },
};

const Block = memo(function Block({ text }: { text: string }) {
  return (
    <ReactMarkdown remarkPlugins={remarkPlugins} components={components}>
      {text}
    </ReactMarkdown>
  );
});

/**
 * Splits at blank lines outside code fences, when the next line starts at
 * column 0 (so indented list continuations stay attached to their item).
 */
export function splitBlocks(src: string): string[] {
  const lines = src.replace(/\r/g, '').split('\n');
  const blocks: string[] = [];
  let cur: string[] = [];
  let fence: string | null = null;
  let blank = false;
  for (const line of lines) {
    const f = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length && /^\s*(`{3,}|~{3,})\s*$/.test(line)) fence = null;
      cur.push(line);
      continue;
    }
    if (/^\s*$/.test(line)) { blank = true; cur.push(line); continue; }
    if (blank && cur.some(l => l.trim()) && !/^\s/.test(line)) {
      blocks.push(cur.join('\n'));
      cur = [];
    }
    blank = false;
    if (f) fence = f[1];
    cur.push(line);
  }
  if (cur.length) blocks.push(cur.join('\n'));
  return blocks;
}

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  const blocks = useMemo(() => splitBlocks(text), [text]);
  return (
    <div className="md">
      {blocks.map((b, i) => <Block key={i} text={b} />)}
    </div>
  );
});
