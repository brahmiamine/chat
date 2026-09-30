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
      const detail = (e.message || '').trim();

      if (/DEGRADED function cannot be invoked/i.test(detail)) {
        return {
          title: 'Endpoint NVIDIA temporairement indisponible.',
          hint: detail,
          http: true,
        };
      }

      if (/unsupported parameter/i.test(detail)) {
        return {
          title: 'Paramètre non supporté par ce modèle.',
          hint: detail,
          http: true,
        };
      }

      if (/public api endpoints|not found for account|authorization failed|permission/i.test(detail)) {
        return {
          title: 'Accès NVIDIA NIM non autorisé pour cette clé.',
          hint: detail,
          http: true,
        };
      }

      if (/context_exceeded|maximum context|context length|\bctx\b/i.test(detail)) {
        return {
          title: 'Contexte trop long pour ce modèle.',
          hint: detail || 'Réduisez le contexte ou démarrez une nouvelle conversation.',
          http: true,
        };
      }

      return {
        title: 'Requête refusée par le fournisseur (HTTP 400).',
        hint: detail || 'Le fournisseur a refusé la requête sans donner de détail.',
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
