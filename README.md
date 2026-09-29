# Lueur — client de chat pour LLM local

Interface de chat (React + TypeScript + Vite) pour un modèle servi par **llama.cpp / llama-server**, via l’API **compatible OpenAI**. Implémentation de la maquette Claude Design « Lueur Chat ».

## Démarrage

```bash
npm install
npm run dev        # http://localhost:5173 (exposé sur le réseau local)
npm run build      # build de production dans dist/
npm run preview    # sert dist/
```

Côté serveur, lancez llama-server en écoute sur le réseau :

```bash
llama-server -hf lmstudio-community/Qwen3.5-4B-GGUF:Q4_K_M --host 127.0.0.1 --port 8080 -c 4096 -np 1 --mmproj-auto
```

Serveur par défaut : `https://below-cancer-loads-dat.trycloudflare.com` (llama-server exposé via un tunnel Cloudflare). L’URL racine ou l’endpoint complet `…/v1/chat/completions` sont acceptés. Vous pouvez le modifier dans **Paramètres → Connexion**, ou fixer d’autres valeurs initiales dans un fichier `.env.local` (voir `.env.example`).

> **HTTPS :** un navigateur bloque les appels d’une page HTTPS vers un serveur HTTP (*mixed content*). Servez l’application en HTTP sur le LAN, ou placez llama-server derrière un proxy HTTPS.

## Déploiement GitHub Pages

Chaque push sur `main` lance `.github/workflows/deploy.yml`, qui construit l’application et la publie sur **https://brahmiamine.github.io/chat/**.
Au premier déploiement, vérifiez dans *Settings → Pages* du dépôt que la source est **GitHub Actions**.

**CORS :** le navigateur n’accepte la réponse que si llama-server autorise l’origine du site. Les versions récentes limitent CORS à `localhost` dès que les outils, MCP ou le mode agent sont activés. Dans ce cas, ajoutez :

```bash
llama-server ... --cors-origins https://brahmiamine.github.io
```

GitHub Pages est servi en HTTPS : l’API doit donc l’être aussi (c’est le cas du tunnel Cloudflare). L’URL d’un tunnel `trycloudflare.com` change à chaque redémarrage de `cloudflared` : mettez-la alors à jour dans *Paramètres → Connexion*.

## Servir l’application depuis llama-server (recommandé avec un tunnel)

llama-server peut servir l’application lui-même. L’interface et l’API ont alors la même adresse : **aucun problème de CORS**, et rien à reconfigurer quand l’URL du tunnel change (l’application utilise automatiquement sa propre adresse).

```bash
# une seule fois (Termux : pkg install git)
git clone -b dist --depth 1 https://github.com/brahmiamine/chat ~/lueur-ui
# pour mettre à jour plus tard
git -C ~/lueur-ui pull

# Le script scripts/start-ai.sh génère un fichier de presets avec Qwen + Gemma,
# puis lance llama-server en mode router avec --models-max 1.
~/start-ai.sh
cloudflared tunnel --protocol http2 --url http://127.0.0.1:8080
```

Ou, plus simple, le script `scripts/start-ai.sh` fait tout (interface, llama-server avec `--path` et `--cors-origins`, tunnel) et affiche l’URL :

```bash
curl -fsSL https://raw.githubusercontent.com/brahmiamine/chat/main/scripts/start-ai.sh -o ~/start-ai.sh && chmod +x ~/start-ai.sh
~/start-ai.sh            # démarrer / afficher l’URL
~/start-ai.sh restart    # tout redémarrer
~/start-ai.sh stop       # tout arrêter
```

Ouvrez ensuite directement l’URL `https://…trycloudflare.com` affichée par cloudflared (ou `http://127.0.0.1:8080` sur le téléphone). La branche `dist` est reconstruite à chaque push sur `main`.

## Fonctionnalités

- Réponses en streaming (SSE) affichées au plus une fois par frame, bouton **Stop** et touche Échap, délai d’inactivité de 90 s
- Historique dans **IndexedDB** : nouvelle conversation, renommer, supprimer (avec confirmation), recherche (⌘/Ctrl K), titre généré automatiquement, conversation restaurée après un rechargement. Les réponses partielles sont sauvegardées pendant la génération.
- Markdown GFM (titres, listes, tableaux, citations, liens) et blocs de code avec coloration syntaxique (highlight.js), bouton **Copier** sur le code et sur la réponse, bouton **Régénérer**
- Balises `<think>` masquées (Qwen3, DeepSeek-R1) pendant que le modèle « réfléchit »
- Défilement automatique uniquement si l’utilisateur est déjà en bas, avec un bouton « Aller en bas »
- Indicateur En ligne / Hors ligne / Chargement du modèle, basé sur `GET /health` (interrogé toutes les 20 s, et aussi au retour du réseau ou de l’onglet)
- Paramètres : URL, clé API, **Tester la connexion**, infos serveur (`/v1/models`, `/props`), modèles avec nom affiché, instructions système, température, top P, tokens max, taille du contexte (l’historique envoyé est tronqué pour tenir dans cette taille)
- Thème clair / sombre / système, trois tailles de texte
- Mise en page responsive : tiroir sur mobile, prise en compte du clavier iOS/Android, zones tactiles d’au moins 44 px
- Entrée pour envoyer, Maj + Entrée pour aller à la ligne, ⌘/Ctrl N (ou ⇧⌘O) pour une nouvelle conversation
- Pièces jointes **image, PDF et texte/code** : images envoyées au modèle vision ; texte des PDF extrait localement avec PDF.js ; PDF scannés convertis en images (jusqu’aux 3 premières pages)
- Router llama.cpp avec **7 modèles** sélectionnables : Qwen3.5 4B Vision, Gemma 3 4B Vision, Phi-4 Mini 3.8B, Llama 3.2 3B, SmolLM3 3B, DeepSeek R1 1.5B et Qwen2.5 Coder 3B ; `--models-max 1` limite la RAM à un seul modèle chargé à la fois
- Mode démo hors ligne

## Architecture

```
src/
├── services/
│   ├── llmApi.ts        # SEUL module qui parle au serveur (OpenAI-compatible)
│   ├── demoProvider.ts  # réponses simulées
│   ├── db.ts            # IndexedDB
│   └── errors.ts        # erreurs → messages lisibles (jamais de stack trace)
├── hooks/
│   ├── useChat.ts       # conversations, envoi, streaming, stop, régénération, persistance
│   ├── useServerHealth.ts
│   ├── useSettings.ts / useTheme.ts / useViewport.ts / useAutoScroll.ts / useCopy.ts
├── components/
│   ├── chat/            # ChatHeader, ChatView, Messages, Markdown, CodeBlock, Composer, EmptyState
│   ├── sidebar/         # Sidebar, ConversationItem
│   ├── search/          # SearchDialog
│   ├── settings/        # SettingsModal + un fichier par onglet
│   └── ui/              # Icons, Tooltip, Segmented
├── lib/                 # fonctions pures + préparation locale images/PDF
├── types/               # types TypeScript partagés
└── styles/global.css    # tokens de la maquette (clair/sombre) + styles
```

### Changer de fournisseur

`services/llmApi.ts` n’utilise que le protocole OpenAI :

| Appel | Rôle |
|---|---|
| `POST /v1/chat/completions` (`stream: true`) | génération en streaming |
| `GET /health` | statut ; si le serveur renvoie 404, repli sur `GET /v1/models` |
| `GET /v1/models` | liste des modèles |
| `GET /props` | infos llama.cpp (facultatif) |

Pour passer à **OpenAI** (`https://api.openai.com`), **Ollama** (`http://host:11434`), **vLLM**, LM Studio ou LiteLLM, il suffit de changer l’URL, la clé et l’identifiant du modèle dans les paramètres. Aucune modification de code n’est nécessaire. Pour un protocole différent (par exemple l’API Anthropic native), écrivez un module qui expose la même fonction `streamChat(cfg, params, signal)` (un `AsyncGenerator<string>`) et branchez-le dans `useChat.ts`.

### Performances

- Les tokens sont regroupés et affichés au plus une fois par frame (`requestAnimationFrame`).
- Le texte en cours de génération est gardé dans un état séparé : la barre latérale et les messages déjà terminés ne se ré-affichent pas à chaque token.
- Le Markdown est découpé en blocs mémoïsés : pendant le streaming, seul le dernier bloc est ré-analysé. La coloration syntaxique est mise en cache.
- Markdown et highlight.js sont dans un chunk séparé, préchargé quand le navigateur est inactif.


## Accès public : Serveo

Lueur utilise désormais **Serveo** pour l'accès public gratuit. Le tunnel passe par SSH et ne nécessite pas de client spécifique supplémentaire.

Le script `start-ai.sh` lance automatiquement :

```bash
ssh \
  -T \
  -o BatchMode=yes \
  -o StrictHostKeyChecking=accept-new \
  -o ServerAliveInterval=30 \
  -o ServerAliveCountMax=3 \
  -o ExitOnForwardFailure=yes \
  -R 80:127.0.0.1:8080 \
  serveo.net
```

Serveo fournit une URL HTTPS publique, généralement sous `*.serveousercontent.com`. Le script récupère cette URL, l'enregistre dans `~/ai-url.txt` et vérifie automatiquement `/health`.

Si Serveo renvoie un hostname dont le certificat TLS n'est pas encore exploitable, le script ferme le tunnel et effectue automatiquement une seconde tentative pour obtenir une nouvelle URL.

Pour démarrer :

```bash
pkg install openssh -y
~/start-ai.sh restart
```

Pour arrêter Lueur, le modèle et le tunnel :

```bash
~/start-ai.sh stop
```

Le script arrête également d'anciens tunnels Cloudflare ou localhost.run qui seraient encore actifs.

## Android / Termux : router multi-modèles

Le router officiel de `llama-server` dépend de `LLAMA_SUBPROCESS`. Ce support est désactivé par défaut sur Android et ne compile pas actuellement sur Bionic/Termux à cause de `posix_spawn_file_actions_addchdir_np`.

Lueur utilise donc `scripts/model-router.py`, un petit router HTTP Python compatible Termux :

```text
Serveo / Lueur :8080
        ↓
router Python
        ↓
llama-server :8081
        ↓
1 seul modèle chargé à la fois
```

Compilez `llama.cpp` en mode Android normal, sans subprocess :

```bash
cd ~/llama.cpp
git pull --ff-only
rm -rf build
cmake -B build -DCMAKE_BUILD_TYPE=Release -DLLAMA_SUBPROCESS=OFF
cmake --build build -j2 --target llama-server
```

Puis installez Python si nécessaire et relancez Lueur :

```bash
pkg install python -y
curl -fsSL https://raw.githubusercontent.com/brahmiamine/chat/main/scripts/start-ai.sh -o ~/start-ai.sh
chmod +x ~/start-ai.sh
~/start-ai.sh restart
```

Le router démarre automatiquement le modèle demandé par le champ OpenAI `model`, arrête le précédent, attend son chargement et relaie le streaming. Des commentaires SSE gardent la connexion ouverte pendant un premier téléchargement long.

## Modèles texte de test

Les modèles texte supplémentaires sont chargés à la demande par le router :

- `bartowski/microsoft_Phi-4-mini-instruct-GGUF:Q4_K_M`
- `bartowski/Llama-3.2-3B-Instruct-GGUF:Q4_K_M`
- `bartowski/HuggingFaceTB_SmolLM3-3B-GGUF:Q4_K_M`
- `bartowski/DeepSeek-R1-Distill-Qwen-1.5B-GGUF:Q4_K_M`
- `bartowski/Qwen2.5-Coder-3B-Instruct-GGUF:Q4_K_M`

Le premier appel à un modèle non encore présent dans le cache déclenche son téléchargement. Un seul modèle est chargé en RAM à la fois.
