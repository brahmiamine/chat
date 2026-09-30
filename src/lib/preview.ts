/**
 * Sandboxed previews of generated code (HTML, SVG, Mermaid, React, JS).
 *
 * Security model — the code comes from an LLM (possibly steered by a web page
 * it read), so:
 * - it runs in `<iframe sandbox="allow-scripts …">` WITHOUT allow-same-origin:
 *   opaque origin, no access to the app's localStorage (API key), IndexedDB
 *   (conversations) or cookies;
 * - a CSP is injected first in the document: no fetch/XHR/WebSocket
 *   (`connect-src 'none'`), no form submission, scripts only inline or from a
 *   few public CDNs. The page cannot call the Lueur router or the Worker;
 * - console output and errors come back through postMessage, and the parent
 *   only accepts messages whose source is the preview's own window.
 */

export const PREVIEW_SANDBOX = 'allow-scripts allow-modals allow-forms allow-pointer-lock';

const CDNS = 'https://cdn.jsdelivr.net https://unpkg.com https://cdnjs.cloudflare.com https://cdn.tailwindcss.com';

export const PREVIEW_CSP = [
  "default-src 'none'",
  `script-src 'unsafe-inline' 'unsafe-eval' blob: ${CDNS}`,
  `style-src 'unsafe-inline' ${CDNS} https://fonts.googleapis.com`,
  `font-src data: ${CDNS} https://fonts.gstatic.com`,
  'img-src data: blob: https:',
  'media-src data: blob: https:',
  "connect-src 'none'",
  "form-action 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
].join('; ');

/** Messages posted by the preview's console bridge. */
export interface PreviewConsoleEntry {
  level: 'log' | 'info' | 'warn' | 'error' | 'debug';
  text: string;
}

export const PREVIEW_MESSAGE_KEY = '__lueurPreview';

const BRIDGE = `(function(){
var K=${JSON.stringify(PREVIEW_MESSAGE_KEY)};
function fmt(a){try{if(a instanceof Error)return a.stack||String(a);if(a&&typeof a==='object')return JSON.stringify(a,null,2);return String(a)}catch(e){return String(a)}}
function send(level,args){try{var m={};m[K]=1;m.level=level;m.text=[].map.call(args,fmt).join(' ');parent.postMessage(m,'*')}catch(e){}}
['log','info','warn','error','debug'].forEach(function(l){var o=console[l];console[l]=function(){send(l,arguments);if(o)return o.apply(console,arguments)}});
addEventListener('error',function(e){send('error',[(e.message||'Erreur')+(e.lineno?' (ligne '+e.lineno+')':'')])});
addEventListener('unhandledrejection',function(e){var r=e.reason;send('error',['Promesse rejetée : '+(r&&(r.stack||r.message)||r)])});
addEventListener('securitypolicyviolation',function(e){send('warn',['Bloqué par la sécurité de l’aperçu : '+(e.blockedURI||'inline')+' ('+e.effectiveDirective+')'])});
})();`;

const HEAD = `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}"><meta name="viewport" content="width=device-width, initial-scale=1"><script>${BRIDGE}</script>`;

/** Safe to embed as a JS string literal inside an inline <script>. */
function scriptLiteral(value: string): string {
  return JSON.stringify(value).replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Inserts the CSP + console bridge before anything the page could run. */
export function injectHead(html: string): string {
  const head = /<head\b[^>]*>/i.exec(html);
  if (head) return html.slice(0, head.index + head[0].length) + HEAD + html.slice(head.index + head[0].length);
  const root = /<html\b[^>]*>/i.exec(html);
  if (root) return html.slice(0, root.index + root[0].length) + `<head>${HEAD}</head>` + html.slice(root.index + root[0].length);
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html);
  if (doctype) return doctype[0] + `<head>${HEAD}</head>` + html.slice(doctype[0].length);
  return `<!doctype html><html><head>${HEAD}</head><body>${html}</body></html>`;
}

function page(body: string, style = '', dark = false): string {
  const base = `html,body{margin:0}body{font-family:system-ui,sans-serif;${dark ? 'background:#161514;color:#ebe7e0;' : ''}}`;
  return `<!doctype html><html><head>${HEAD}<style>${base}${style}</style></head><body>${body}</body></html>`;
}

export interface PreviewSource {
  html?: string;
  css?: string[];
  js?: string[];
}

/** HTML page, optionally combined with the CSS/JS files of the same answer. */
export function htmlDocument({ html = '', css = [], js = [] }: PreviewSource): string {
  let doc = html.trim() ? html : '<!doctype html><html><head></head><body></body></html>';
  if (css.length) {
    const style = css.map(c => `<style>${c}</style>`).join('');
    doc = /<\/head>/i.test(doc) ? doc.replace(/<\/head>/i, `${style}</head>`) : style + doc;
  }
  if (js.length) {
    const scripts = js.map(c => `<script>${c.replace(/<\/(script)/gi, '<\\/$1')}</script>`).join('');
    doc = /<\/body>/i.test(doc) ? doc.replace(/<\/body>(?![\s\S]*<\/body>)/i, `${scripts}</body>`) : doc + scripts;
  }
  return injectHead(doc);
}

export function svgDocument(svg: string, dark = false): string {
  return page(svg, 'body{min-height:100vh;display:grid;place-items:center;padding:16px;box-sizing:border-box}svg{max-width:100%;height:auto}', dark);
}

export function mermaidDocument(code: string, dark = false): string {
  return page(
    `<pre class="mermaid">${escapeHtml(code)}</pre>
<script type="module">
import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
mermaid.initialize({ startOnLoad: false, theme: ${dark ? "'dark'" : "'default'"}, securityLevel: 'strict' });
try { await mermaid.run({ querySelector: '.mermaid' }); } catch (e) { console.error(e && e.message || String(e)); }
</script>`,
    'body{padding:16px}.mermaid{display:flex;justify-content:center;margin:0;background:none}',
    dark,
  );
}

/**
 * React component preview: Babel (JSX/TSX) + React 18 UMD from a CDN. The
 * component's default export (or `App`) is rendered; `react` / `react-dom`
 * imports map to the globals, other imports are reported in the console.
 */
export function reactDocument(code: string, css: string[] = [], dark = false): string {
  return page(
    `<div id="root"></div>
<script src="https://cdn.tailwindcss.com"></script>
<script src="https://cdn.jsdelivr.net/npm/react@18.3.1/umd/react.development.js"></script>
<script src="https://cdn.jsdelivr.net/npm/react-dom@18.3.1/umd/react-dom.development.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@babel/standalone@7/babel.min.js"></script>
<script>
(function () {
  var source = ${scriptLiteral(code)};
  try {
    var out = Babel.transform(source, {
      filename: 'App.tsx',
      presets: [['react', { runtime: 'classic' }], ['typescript', { isTSX: true, allExtensions: true }]],
      plugins: ['transform-modules-commonjs'],
    }).code;
    var modules = { 'react': React, 'react-dom': ReactDOM, 'react-dom/client': ReactDOM };
    var module = { exports: {} };
    var require = function (name) {
      if (modules[name]) return modules[name];
      if (/\\.css$/.test(name)) return {};
      throw new Error('Module « ' + name + ' » non disponible dans l’aperçu (seuls react et react-dom le sont).');
    };
    new Function('require', 'module', 'exports', 'React', out)(require, module, module.exports, React);
    var App = module.exports.default || module.exports.App || (typeof window.App === 'function' && window.App);
    if (!App) throw new Error('Aucun composant trouvé : exporte-le avec « export default ».');
    ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(App));
  } catch (e) {
    console.error(e && e.message || String(e));
  }
})();
</script>`,
    css.join('\n'),
    dark,
  );
}

/** "Run" for plain JavaScript: the console is the output. */
export function scriptDocument(code: string, dark = false): string {
  return page(
    `<script>
try { new Function(${scriptLiteral(code)})(); } catch (e) { console.error(e && e.stack || String(e)); }
</script>`,
    '',
    dark,
  );
}
