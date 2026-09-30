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
    hint: `Vérifiez l’URL (${host}), le tunnel ngrok et la configuration CORS du router pour ${origin}.`,
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
    return {
      title: 'La connexion a été coupée pendant la réponse.',
      hint: 'Lueur tente de reprendre le flux automatiquement. Vérifiez ngrok et le réseau si cela se répète.',
    };
  }
  if (e instanceof LLMApiError) {
    const st = e.status;
    if (/non configuré|\.lueur\.env|API_KEY|HF_TOKEN|CLOUDFLARE_/i.test(e.message)) {
      return { title: 'Fournisseur cloud non configuré.', hint: e.message, http: true };
    }
    if (st === 503) return { title: 'Le modèle n’est pas encore chargé.', hint: 'Le modèle est encore en cours de chargement. Réessayez dans quelques secondes.', http: true };
    if (st === 401 || st === 403) return { title: 'Accès refusé par le fournisseur.', hint: 'Vérifiez la clé du fournisseur côté Termux dans ~/.lueur.env.', http: true };
    if (st === 404) return { title: 'Point d’accès ou modèle introuvable.', hint: 'Vérifiez le modèle sélectionné et la configuration du fournisseur.', http: true };
    if (st === 410) return { title: 'Ce modèle a été retiré par le fournisseur.', hint: e.message || 'Choisissez un modèle actuellement disponible chez ce fournisseur.', http: true };
    if (st === 429) return { title: 'Quota ou limite de débit atteint.', hint: 'Attendez un peu ou essayez un autre fournisseur/modèle.', http: true };
    if (st === 400) {
      return {
        title: 'Requête refusée par le serveur.',
        hint: /context|ctx|token/i.test(e.message)
          ? 'La conversation dépasse peut-être la taille du contexte. Réduisez le contexte ou démarrez une nouvelle conversation.'
          : 'Les paramètres ou le format de la requête ne sont pas acceptés par ce modèle.',
        http: true,
      };
    }
    return { title: `Erreur du serveur (HTTP ${st}).`, hint: e.message || 'Réessayez ou consultez les journaux du router.', http: true };
  }
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { title: 'Connexion réseau perdue.', hint: 'Vérifiez votre Wi-Fi puis réessayez.' };
  }
  if (isMixedContent(baseUrl)) {
    return {
      title: 'Impossible de joindre le serveur IA.',
      hint: 'Cette page est servie en HTTPS et le navigateur bloque les appels vers un serveur HTTP. Utilisez l’URL HTTPS ngrok.',
      demo: true,
    };
  }
  return { title: 'Impossible de joindre le serveur IA.', hint: 'Vérifiez que le router Lueur est démarré et accessible.', demo: true };
}

/** An HTTPS page cannot call an HTTP server: the browser blocks it before any request. */
export function isMixedContent(baseUrl: string): boolean {
  return typeof location !== 'undefined' && location.protocol === 'https:' && /^http:/i.test(baseUrl || '');
}
