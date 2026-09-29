/** Maps any failure to a short, human message. Never exposes stack traces. */
import type { ChatError } from '../types';
import { isReachableIgnoringCors, LLMApiError, StreamInterruptedError } from './llmApi';

export type AbortReason = 'user' | 'timeout' | null;

export function corsError(baseUrl: string): ChatError {
  const origin = typeof location !== 'undefined' ? location.origin : '';
  let host = baseUrl;
  try { host = new URL(baseUrl).host; } catch { /* keep raw */ }
  return {
    title: 'Le serveur répond, mais sa réponse est bloquée par le navigateur.',
    hint: `Vérifiez d’abord l’URL (${host}) : un tunnel arrêté renvoie une page d’erreur Cloudflare. Sinon, llama-server n’autorise pas ${origin} : relancez-le avec --cors-origins ${origin}.`,
  };
}

/**
 * Like friendlyError, but when a request failed at the network level it probes
 * the server with a CORS-free request to tell "unreachable" from "CORS-blocked".
 */
export async function diagnoseError(e: unknown, baseUrl: string, reason: AbortReason = null): Promise<ChatError> {
  const isNetworkFailure = e instanceof TypeError && !reason && !isMixedContent(baseUrl) && navigator.onLine;
  if (isNetworkFailure && (await isReachableIgnoringCors({ baseUrl }))) return corsError(baseUrl);
  return friendlyError(e, baseUrl, reason);
}

export function friendlyError(e: unknown, baseUrl: string, reason: AbortReason = null): ChatError {
  const name = (e as { name?: string } | null)?.name;
  if (reason === 'timeout' || name === 'TimeoutError') {
    return { title: 'Le serveur met trop de temps à répondre.', hint: 'Le modèle est peut-être occupé ou surchargé. Réessayez dans un instant.' };
  }
  if (e instanceof StreamInterruptedError) {
    return { title: 'La connexion a été coupée pendant la réponse.', hint: 'Le tunnel ou le réseau a interrompu le flux. Réessayez ; si cela se répète, vérifiez cloudflared.' };
  }
  if (e instanceof LLMApiError) {
    const st = e.status;
    if (st === 503) return { title: 'Le modèle n’est pas encore chargé.', hint: 'llama-server charge le modèle en mémoire. Réessayez dans quelques secondes.', http: true };
    if (st === 401 || st === 403) return { title: 'Accès refusé par le serveur.', hint: 'Vérifiez la clé API dans Paramètres → Connexion.', http: true };
    if (st === 404) return { title: 'Point d’accès introuvable.', hint: 'Vérifiez l’URL du serveur et le modèle dans Paramètres.', http: true };
    if (st === 400) {
      return {
        title: 'Requête refusée par le serveur.',
        hint: /context|ctx|token/i.test(e.message)
          ? 'La conversation dépasse la taille du contexte. Réduisez « Taille du contexte » ou démarrez une nouvelle conversation.'
          : 'Les paramètres envoyés ne sont pas acceptés. Essayez de réinitialiser la génération.',
        http: true,
      };
    }
    return { title: `Erreur du serveur (HTTP ${st}).`, hint: 'Réessayez ou consultez les journaux du serveur.', http: true };
  }
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { title: 'Connexion réseau perdue.', hint: 'Vérifiez votre Wi-Fi puis réessayez.' };
  }
  if (isMixedContent(baseUrl)) {
    return {
      title: 'Impossible de joindre le serveur IA.',
      hint: 'Cette page est servie en HTTPS et le navigateur bloque les appels vers un serveur HTTP. Ouvrez l’application en local, ou exposez llama-server en HTTPS.',
      demo: true,
    };
  }
  return { title: 'Impossible de joindre le serveur IA.', hint: 'Vérifiez que llama-server est démarré et accessible sur le réseau.', demo: true };
}

/** An HTTPS page cannot call an HTTP server: the browser blocks it before any request. */
export function isMixedContent(baseUrl: string): boolean {
  return typeof location !== 'undefined' && location.protocol === 'https:' && /^http:/i.test(baseUrl || '');
}
