/** highlight.js core with a curated set of languages (keeps the bundle small). */
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import go from 'highlight.js/lib/languages/go';
import ini from 'highlight.js/lib/languages/ini';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import kotlin from 'highlight.js/lib/languages/kotlin';
import markdown from 'highlight.js/lib/languages/markdown';
import php from 'highlight.js/lib/languages/php';
import python from 'highlight.js/lib/languages/python';
import ruby from 'highlight.js/lib/languages/ruby';
import rust from 'highlight.js/lib/languages/rust';
import scss from 'highlight.js/lib/languages/scss';
import shell from 'highlight.js/lib/languages/shell';
import sql from 'highlight.js/lib/languages/sql';
import swift from 'highlight.js/lib/languages/swift';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

const langs = { bash, c, cpp, csharp, css, diff, dockerfile, go, ini, java, javascript, json, kotlin, markdown, php, python, ruby, rust, scss, shell, sql, swift, typescript, xml, yaml };
for (const [name, def] of Object.entries(langs)) hljs.registerLanguage(name, def);
hljs.registerAliases(['sh', 'zsh'], { languageName: 'bash' });
hljs.registerAliases(['toml', 'env', 'conf'], { languageName: 'ini' });
hljs.registerAliases(['tsx'], { languageName: 'typescript' });
hljs.registerAliases(['jsx'], { languageName: 'javascript' });
hljs.registerAliases(['vue', 'svelte'], { languageName: 'xml' });

const LABELS: Record<string, string> = {
  ts: 'TypeScript', typescript: 'TypeScript', tsx: 'TSX', js: 'JavaScript', javascript: 'JavaScript', jsx: 'JSX',
  py: 'Python', python: 'Python', sh: 'Bash', bash: 'Bash', shell: 'Shell', zsh: 'Zsh', json: 'JSON', html: 'HTML',
  css: 'CSS', scss: 'SCSS', sql: 'SQL', yaml: 'YAML', yml: 'YAML', go: 'Go', rust: 'Rust', rs: 'Rust', java: 'Java',
  c: 'C', cpp: 'C++', 'c++': 'C++', cs: 'C#', csharp: 'C#', php: 'PHP', rb: 'Ruby', ruby: 'Ruby', md: 'Markdown',
  markdown: 'Markdown', xml: 'XML', dockerfile: 'Dockerfile', toml: 'TOML', ini: 'INI', diff: 'Diff', kotlin: 'Kotlin',
  kt: 'Kotlin', swift: 'Swift', text: 'Texte', txt: 'Texte', plaintext: 'Texte',
};

export function languageLabel(lang: string): string {
  const l = (lang || '').toLowerCase();
  return LABELS[l] || (l ? l.charAt(0).toUpperCase() + l.slice(1) : 'Code');
}

const cache = new Map<string, string>();

/** Returns escaped, highlighted HTML (safe for innerHTML). Memoized for streaming re-renders. */
export function highlightToHtml(code: string, lang: string): string {
  const l = (lang || '').toLowerCase();
  const key = l + '\u0000' + code;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  let html: string;
  if (l && hljs.getLanguage(l)) html = hljs.highlight(code, { language: l, ignoreIllegals: true }).value;
  else if (!l || /^(text|txt|plaintext)$/.test(l)) html = escapeHtml(code);
  else html = hljs.highlightAuto(code).value;
  if (cache.size > 200) cache.clear();
  cache.set(key, html);
  return html;
}

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
