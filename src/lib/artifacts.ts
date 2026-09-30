/**
 * Artifacts: things the assistant *builds* (a web page, a diagram, a React
 * component…) are pulled out of the answer, versioned per conversation and
 * shown in a side panel with Code / Preview / Console.
 */
import type { Artifact, ArtifactFile, ArtifactKind } from '../types';
import { uid } from './chat';
import { htmlDocument, mermaidDocument, reactDocument, scriptDocument, svgDocument } from './preview';

export interface CodeFence {
  lang: string;
  code: string;
  /** False while the closing ``` has not arrived yet (streaming/truncated). */
  complete: boolean;
}

/** Top-level fenced code blocks of a Markdown answer. */
export function extractFences(markdown: string): CodeFence[] {
  const out: CodeFence[] = [];
  const lines = markdown.replace(/\r/g, '').split('\n');
  let fence: { marker: string; lang: string; body: string[] } | null = null;
  for (const line of lines) {
    if (!fence) {
      const open = /^\s{0,3}(`{3,}|~{3,})\s*([\w+#.-]*)/.exec(line);
      if (open) fence = { marker: open[1], lang: open[2].toLowerCase(), body: [] };
      continue;
    }
    const close = /^\s{0,3}(`{3,}|~{3,})\s*$/.exec(line);
    if (close && close[1][0] === fence.marker[0] && close[1].length >= fence.marker.length) {
      out.push({ lang: fence.lang, code: fence.body.join('\n'), complete: true });
      fence = null;
    } else {
      fence.body.push(line);
    }
  }
  if (fence) out.push({ lang: fence.lang, code: fence.body.join('\n'), complete: false });
  return out;
}

const LANG_KIND: Record<string, ArtifactKind> = {
  html: 'html', htm: 'html', xhtml: 'html',
  svg: 'svg',
  mermaid: 'mermaid', mmd: 'mermaid',
  jsx: 'react', tsx: 'react', react: 'react',
  md: 'markdown', markdown: 'markdown',
  json: 'json', json5: 'json', geojson: 'json',
  csv: 'csv', tsv: 'csv',
  js: 'javascript', javascript: 'javascript', mjs: 'javascript',
};

export function kindOf(lang: string, code: string): ArtifactKind {
  const l = lang.toLowerCase();
  if (LANG_KIND[l]) {
    // A "jsx" block without JSX or exports is just JavaScript.
    if (LANG_KIND[l] === 'react' && !/export\s+default|function\s+App\b|<[A-Za-z]/.test(code)) return 'javascript';
    return LANG_KIND[l];
  }
  const head = code.trimStart().slice(0, 200).toLowerCase();
  if ((l === 'xml' || !l) && head.startsWith('<svg')) return 'svg';
  if (!l && (head.startsWith('<!doctype html') || head.startsWith('<html'))) return 'html';
  return 'code';
}

/** Kinds with a visual preview (the others only get Copy/Download). */
export function hasPreview(kind: ArtifactKind): boolean {
  return kind !== 'code';
}

/** Kinds rendered in a sandboxed iframe (they may run code). */
export function isFrameKind(kind: ArtifactKind): boolean {
  return kind === 'html' || kind === 'svg' || kind === 'mermaid' || kind === 'react' || kind === 'javascript';
}

const EXT: Record<string, string> = {
  html: 'html', htm: 'html', svg: 'svg', mermaid: 'mmd', mmd: 'mmd', jsx: 'jsx', tsx: 'tsx',
  md: 'md', markdown: 'md', json: 'json', csv: 'csv', tsv: 'tsv', js: 'js', javascript: 'js', mjs: 'js',
  css: 'css', ts: 'ts', typescript: 'ts', py: 'py', python: 'py', sh: 'sh', bash: 'sh', sql: 'sql',
  yaml: 'yaml', yml: 'yml', xml: 'xml', java: 'java', go: 'go', rs: 'rs', rust: 'rs', c: 'c', cpp: 'cpp',
  php: 'php', rb: 'rb', kotlin: 'kt', swift: 'swift', txt: 'txt',
};

export function extensionOf(lang: string): string {
  return EXT[lang.toLowerCase()] || 'txt';
}

export function defaultFileName(lang: string, kind: ArtifactKind): string {
  if (kind === 'html') return 'index.html';
  if (kind === 'react') return `App.${extensionOf(lang) === 'tsx' ? 'tsx' : 'jsx'}`;
  const ext = extensionOf(lang);
  if (ext === 'css') return 'style.css';
  if (ext === 'js') return 'script.js';
  return `fichier.${ext}`;
}

const MIME: Record<string, string> = {
  html: 'text/html', svg: 'image/svg+xml', json: 'application/json', csv: 'text/csv', md: 'text/markdown',
  js: 'text/javascript', css: 'text/css',
};

export function mimeOf(fileName: string): string {
  return MIME[fileName.split('.').pop() || ''] || 'text/plain';
}

// ---- detection -------------------------------------------------------------

const PRIMARY: ArtifactKind[] = ['html', 'react', 'svg', 'mermaid'];
const MIN_CHARS: Partial<Record<ArtifactKind, number>> = { html: 250, react: 200, svg: 150, mermaid: 40 };

function titleOf(kind: ArtifactKind, files: ArtifactFile[], answer: string): string {
  const main = files[0]?.code || '';
  const htmlTitle = /<title>([^<]{2,80})<\/title>/i.exec(main)?.[1]?.trim();
  if (htmlTitle) return htmlTitle;
  const heading = /^#{1,3}\s+(.{3,60})$/m.exec(answer)?.[1]?.replace(/[*_`]/g, '').trim();
  if (heading) return heading;
  const component = /export\s+default\s+function\s+([A-Z]\w+)/.exec(main)?.[1];
  if (component && kind === 'react') return component;
  return { html: 'Page web', react: 'Composant React', svg: 'Image SVG', mermaid: 'Diagramme' }[kind as 'html'] || 'Artefact';
}

export interface DetectedArtifact {
  kind: ArtifactKind;
  title: string;
  files: ArtifactFile[];
}

/**
 * An answer "builds something" when it contains a complete HTML page, React
 * component, SVG or Mermaid diagram. For HTML, the CSS/JS blocks of the same
 * answer become extra files of a small project.
 */
export function detectArtifact(answer: string): DetectedArtifact | null {
  const fences = extractFences(answer).filter(f => f.complete);
  for (const kind of PRIMARY) {
    // A complete HTML document always counts; fragments only when substantial.
    const isFullDoc = (code: string) => /<!doctype html|<html[\s>]/i.test(code);
    const main = fences.find(f => kindOf(f.lang, f.code) === kind
      && (f.code.trim().length >= (MIN_CHARS[kind] || 0)
        || (kind === 'html' && isFullDoc(f.code))
        || (kind === 'react' && /export\s+default/.test(f.code))));
    if (!main) continue;
    const files: ArtifactFile[] = [{ name: defaultFileName(main.lang, kind), lang: main.lang || kind, code: main.code }];
    if (kind === 'html' || kind === 'react') {
      for (const f of fences) {
        if (f === main) continue;
        const ext = extensionOf(f.lang);
        if (ext === 'css' || (kind === 'html' && ext === 'js')) {
          const name = ext === 'css' ? 'style.css' : 'script.js';
          files.push({ name: files.some(x => x.name === name) ? `${files.length}-${name}` : name, lang: f.lang, code: f.code });
        }
      }
    }
    return { kind, title: titleOf(kind, files, answer), files };
  }
  return null;
}

export function sameFiles(a: ArtifactFile[], b: ArtifactFile[]): boolean {
  return a.length === b.length && a.every((f, i) => f.name === b[i].name && f.code === b[i].code);
}

/** Adds the answer's artifact to the conversation (new artifact or new version). */
export function mergeArtifact(
  artifacts: Artifact[] = [],
  detected: DetectedArtifact,
  messageId: string,
): { artifacts: Artifact[]; ref: { id: string; version: number } } {
  const now = Date.now();
  const version = { id: uid(), files: detected.files, messageId, source: 'assistant' as const, createdAt: now };
  // Conversational edits: the latest artifact of the same kind gets a new version.
  const target = [...artifacts].sort((a, b) => b.updatedAt - a.updatedAt).find(a => a.kind === detected.kind);
  if (target) {
    const existing = target.versions.findIndex(v => v.messageId === messageId);
    if (existing >= 0) {
      // Regenerated / continued message: replace its own version.
      const versions = target.versions.map((v, i) => (i === existing ? { ...version, id: v.id } : v));
      return {
        artifacts: artifacts.map(a => (a.id === target.id ? { ...a, versions, updatedAt: now } : a)),
        ref: { id: target.id, version: existing + 1 },
      };
    }
    const last = target.versions[target.versions.length - 1];
    if (last && sameFiles(last.files, detected.files)) {
      return { artifacts, ref: { id: target.id, version: target.versions.length } };
    }
    const updated = { ...target, versions: [...target.versions, version], updatedAt: now };
    return {
      artifacts: artifacts.map(a => (a.id === target.id ? updated : a)),
      ref: { id: target.id, version: updated.versions.length },
    };
  }
  const artifact: Artifact = {
    id: uid(), title: detected.title, kind: detected.kind, versions: [version], createdAt: now, updatedAt: now,
  };
  return { artifacts: [...artifacts, artifact], ref: { id: artifact.id, version: 1 } };
}

// ---- rendering --------------------------------------------------------------

export function frameDocument(kind: ArtifactKind, files: ArtifactFile[], dark: boolean): string {
  const main = files[0]?.code || '';
  const css = files.filter(f => extensionOf(f.lang) === 'css' || f.name.endsWith('.css')).map(f => f.code);
  const js = files.slice(1).filter(f => f.name.endsWith('.js')).map(f => f.code);
  switch (kind) {
    case 'html': return htmlDocument({ html: main, css, js });
    case 'svg': return svgDocument(main, dark);
    case 'mermaid': return mermaidDocument(main, dark);
    case 'react': return reactDocument(main, css, dark);
    case 'javascript': return scriptDocument(main, dark);
    default: return '';
  }
}

// ---- conversation context ------------------------------------------------------

/** Replaces an artifact's code in old answers: the current version is sent once, in the instructions. */
export function stripArtifactCode(answer: string, title: string, version: number): string {
  const fences = extractFences(answer);
  if (!fences.length) return answer;
  let out = answer;
  for (const f of fences) {
    const kind = kindOf(f.lang, f.code);
    if (!PRIMARY.includes(kind) && extensionOf(f.lang) !== 'css' && !(kind === 'javascript' && f.code.length > 200)) continue;
    out = out.replace(f.code, `[code de l’artefact « ${title} » v${version} — la version actuelle est dans les instructions]`);
  }
  return out;
}

/** Instructions that let the model edit the current artifact instead of rewriting from scratch. */
export function artifactInstructions(artifact: Artifact, maxChars: number): string {
  const version = artifact.versions[artifact.versions.length - 1];
  const files = version.files;
  const size = files.reduce((n, f) => n + f.code.length, 0);
  const head = `Artefact en cours : « ${artifact.title} » (version ${artifact.versions.length}).`;
  if (size > maxChars) {
    return `${head} Il est trop grand (${size} caractères) pour ton contexte : si l’utilisateur veut le modifier, propose-lui de passer à un modèle cloud.`;
  }
  const blocks = files.map(f => `Fichier ${f.name} :\n\`\`\`${f.lang || extensionOf(f.name)}\n${f.code}\n\`\`\``).join('\n\n');
  return `${head} Si l’utilisateur demande une modification, renvoie le ou les fichiers COMPLETS modifiés, chacun dans un bloc de code du même langage, sans rien omettre ni abréger.\n\n${blocks}`;
}
