/** Pure helpers for conversations: titles, reasoning tags, history building. */
import type { ApiChatMessage, Message, Settings, UserMessage } from '../types';

export const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-5);

const STOP = new Set('le la les un une des du de d l au aux et ou en dans sur pour par avec sans est sont que qui quoi comment pourquoi quel quelle quels quelles je tu il elle on nous vous ils me te se mon ma mes ton ta tes son sa ses ce cet cette ces ca ça peux peut pouvez veux voudrais faire fais créer crée creer explique expliquer explique-moi moi aide aider aidez écris écrire ecris rédige rédiger donne donner corrige corriger montre montrer stp svp bonjour salut merci est-ce quand où combien please how what why the a an to of in on for with is are can you me my i do does'.split(' '));

/** Short title from the first message: "Comment créer une API NestJS avec…" → "API NestJS". */
export function makeTitle(text: string): string {
  const words = String(text)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[^\p{L}\p{N}\s.+#'’-]/gu, ' ')
    .split(/\s+/)
    .map(w => w.replace(/^['’.-]+|['’.-]+$/g, ''))
    .filter(Boolean);
  const sig: { w: string; i: number }[] = [];
  words.forEach((w, i) => {
    const base = w.toLowerCase().replace(/^[ldjmtsnc]['’]/, '');
    if (!STOP.has(w.toLowerCase()) && !STOP.has(base) && base.length > 1) sig.push({ w: w.replace(/^[ldjmtsnc]['’]/i, ''), i });
  });
  const tech = sig.filter(({ w, i }) => /[A-Z0-9#+.]/.test(w.slice(1)) || (i > 0 && /^[A-Z]/.test(w)));
  const pick = (tech.length ? tech.slice(0, 3) : sig.slice(0, 4)).map(x => x.w);
  if (!pick.length) return 'Nouvelle conversation';
  let t = pick.join(' ');
  t = t.charAt(0).toUpperCase() + t.slice(1);
  return t.length > 34 ? t.slice(0, 33) + '…' : t;
}

/** Hides `<think>…</think>` reasoning (Qwen3, DeepSeek-R1…). `thinking` is true while the block is still open. */
export function splitThink(t: string): { text: string; thinking: boolean } {
  const o = t.indexOf('<think>');
  if (o < 0) {
    // While streaming, "<th" may be the beginning of a "<think>" tag: don't flash it.
    const lead = t.trimStart();
    if (lead.length > 0 && lead.length < 7 && '<think>'.startsWith(lead)) return { text: '', thinking: true };
    return { text: t, thinking: false };
  }
  const c = t.indexOf('</think>');
  if (c < 0) return { text: t.slice(0, o), thinking: true };
  return { text: (t.slice(0, o) + t.slice(c + 8)).replace(/^\s+/, ''), thinking: false };
}

function withFiles(m: UserMessage): string {
  let c = m.content || '';
  for (const f of m.files || []) c += `\n\nFichier « ${f.name} » :\n\`\`\`\n${f.text}\n\`\`\``;
  return c;
}

/**
 * Builds the `messages` array sent to the API: system prompt + as much recent
 * history as fits in (contextSize − maxTokens), estimated at ~3.2 chars/token.
 */
export function buildHistory(msgs: Message[], s: Settings): ApiChatMessage[] {
  const out: ApiChatMessage[] = [];
  let budget = Math.max(512, s.contextSize - s.maxTokens) * 3.2;
  const usable = msgs.filter(m => m.role === 'user' || ((m.status === 'done' || m.status === 'stopped') && m.content));
  for (let i = usable.length - 1; i >= 0; i--) {
    const m = usable[i];
    const content = m.role === 'user' ? withFiles(m) : splitThink(m.content).text;
    budget -= content.length;
    if (budget < 0 && out.length) break;
    out.unshift({ role: m.role, content });
  }
  const sys = (s.systemPrompt || '').trim();
  if (sys) out.unshift({ role: 'system', content: sys });
  return out;
}

export const normalize = (t: string) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export function fmtDate(ts: number): string {
  const d = new Date(ts);
  const n = new Date();
  if (d.toDateString() === n.toDateString()) return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

export const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
export const KBD = { k: IS_MAC ? '⌘K' : 'Ctrl K', n: IS_MAC ? '⌘N' : 'Ctrl N' };

export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Clipboard API is unavailable on plain-HTTP LAN origins: fall back to execCommand.
    const a = document.createElement('textarea');
    a.value = text;
    a.style.position = 'fixed';
    a.style.opacity = '0';
    document.body.appendChild(a);
    a.select();
    try { document.execCommand('copy'); } catch { /* ignore */ }
    a.remove();
  }
}
