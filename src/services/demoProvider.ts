/** Offline provider that simulates a streamed answer — handy to try the UI without a server. */

const DEMO_CODE = "Voici une approche simple et typée.\n\n## Fonction utilitaire\n\n```typescript\ntype User = { id: number; name: string }\n\nexport async function fetchUsers(url: string): Promise<User[]> {\n  const res = await fetch(url)\n  if (!res.ok) throw new Error(`HTTP ${res.status}`)\n  return res.json() // tableau d'utilisateurs\n}\n```\n\n**Points clés :**\n\n- `fetch` renvoie une promesse ; on vérifie `res.ok` avant de lire le corps.\n- Le type de retour `Promise<User[]>` documente le contrat.\n- En cas d'erreur, l'appelant peut utiliser `try / catch`.\n\n> Astuce : passez un `AbortController` pour pouvoir annuler la requête.\n\n_Réponse simulée (mode démo)._";

const DEMO_TEXT = "Voici l'essentiel.\n\n### En bref\n\nUn **modèle local** tourne entièrement sur votre machine : aucune donnée ne quitte votre réseau.\n\n| Critère | Local | Cloud |\n|---|---|---|\n| Confidentialité | Totale | Dépend du fournisseur |\n| Latence | Faible sur le LAN | Variable |\n| Coût | Matériel | À l'usage |\n\n1. Démarrez `llama-server` avec votre fichier GGUF.\n2. Pointez l'interface vers `http://ip:8080`.\n3. Discutez.\n\nPlus de détails dans la [documentation llama.cpp](https://github.com/ggml-org/llama.cpp).\n\n_Réponse simulée (mode démo)._";

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
  });
}

export async function* demoStream(prompt: string, signal: AbortSignal): AsyncGenerator<string, void, void> {
  const text = /code|fonction|function|script|typescript|javascript|python|erreur|bug|debug|api|react|node/i.test(prompt) ? DEMO_CODE : DEMO_TEXT;
  await sleep(550, signal);
  for (const piece of text.match(/\s*\S+/g) || []) {
    yield piece;
    await sleep(14 + Math.random() * 30, signal);
  }
}
