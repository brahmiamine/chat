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
~/start-ai.sh status     # état du router, du modèle chargé, du tunnel et du superviseur
~/start-ai.sh boot       # démarrage automatique au boot (app Termux:Boot)
```

Le démarrage n’attend plus les téléchargements : les modèles locaux manquants sont récupérés en arrière-plan (`~/lueur-prefetch.log`) et le router télécharge à la demande celui qu’on utilise, sans conflit entre les deux. Si GitHub est injoignable, la copie locale du router est conservée. Un superviseur relance automatiquement le router et le tunnel s’ils tombent (`~/lueur-supervisor.log`).

Options dans `~/.lueur.env` :

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `LUEUR_PREFETCH` | `all` | modèles pré-téléchargés : `all`, `default` ou `none` |
| `LUEUR_IDLE_UNLOAD` | `600` | secondes d’inactivité avant de décharger le modèle local (`0` = jamais) |
| `LUEUR_CLOUD_UNLOAD` | `0` | `1` = décharger le modèle local dès qu’un modèle cloud est utilisé |
| `LUEUR_SUPERVISE` | `1` | `0` = pas de relance automatique |

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


## Accès public : ngrok via Debian/proot

Lueur utilise **ngrok** pour l'accès public HTTPS. Sur Android/Termux, le binaire Linux ngrok est exécuté dans un petit Debian via `proot-distro`, tandis que Lueur, le router Python et llama.cpp restent directement dans Termux.

Installation initiale :

```bash
pkg install proot-distro -y
proot-distro install debian
proot-distro login debian
```

Puis, dans Debian :

```bash
apt update
apt install -y curl ca-certificates
cd /root
curl -fsSL https://bin.ngrok.com/c/bNyj1mQVY4c/ngrok-v3-stable-linux-arm64.tgz | tar -xz
chmod +x /root/ngrok
/root/ngrok config add-authtoken TON_TOKEN_NGROK
exit
```

Ne stockez jamais l'authtoken dans GitHub.

Ensuite, depuis Termux :

```bash
~/start-ai.sh restart
```

Le script démarre automatiquement ngrok dans Debian/proot avec le domaine réservé de Lueur :

```text
https://expansile-ramiro-intertribal.ngrok-free.dev
```

Il exécute l'équivalent de :

```bash
proot-distro login debian -- \
  /root/ngrok http 8080 \
  --url https://expansile-ramiro-intertribal.ngrok-free.dev
```

L'URL HTTPS est lue depuis l'API locale ngrok sur `127.0.0.1:4040`, enregistrée dans `~/ai-url.txt`, puis `/health` est vérifié automatiquement.

Pour remplacer le domaine réservé sans modifier le script :

```bash
echo "export LUEUR_NGROK_URL='https://autre-domaine.ngrok.app'" >> ~/.lueur.env
```

Le script arrête également les anciens tunnels Serveo, localhost.run et Cloudflare lors d'un redémarrage.

### Génération en arrière-plan

Avec le router Termux de Lueur, une génération appartient désormais au **serveur**, pas à la connexion du navigateur. Si l'onglet est fermé, si Chrome est quitté ou si Android suspend temporairement le navigateur, llama.cpp continue à générer dans Termux.

Chaque réponse en cours possède un `generationId` sauvegardé dans IndexedDB. Quand Lueur est rouvert :

1. l'application retrouve la conversation et son `generationId` ;
2. elle récupère instantanément le texte déjà généré depuis le router ;
3. si la génération est encore en cours, elle se reconnecte au flux SSE au bon curseur ;
4. le bouton **Stop** reste une annulation explicite et arrête réellement le job côté router.

Les jobs terminés sont conservés en mémoire par le router pendant une heure pour permettre une reconnexion. Un redémarrage de Termux/router efface les jobs en mémoire.

### Fournisseurs cloud

Le même router peut maintenant utiliser des modèles locaux **ou** des fournisseurs cloud. Les clés restent uniquement dans Termux et ne sont jamais envoyées au navigateur.

Ajoutez uniquement les fournisseurs que vous souhaitez utiliser dans `~/.lueur.env` :

```bash
# GroqCloud
export GROQ_API_KEY='...'

# Google Gemini
export GEMINI_API_KEY='...'

# Mistral AI
export MISTRAL_API_KEY='...'

# OpenRouter
export OPENROUTER_API_KEY='...'

# Hugging Face Inference Providers
export HF_TOKEN='...'

# NVIDIA NIM
export NVIDIA_API_KEY='...'

# Cohere
export COHERE_API_KEY='...'

# Vercel AI Gateway
export AI_GATEWAY_API_KEY='...'

# Cloudflare Workers AI
export CLOUDFLARE_ACCOUNT_ID='...'
export CLOUDFLARE_AI_API_TOKEN='...'
```

Puis protégez le fichier et redémarrez :

```bash
chmod 600 ~/.lueur.env
~/start-ai.sh restart
```

Les modèles intégrés dans l'interface sont actuellement :

| Fournisseur | Modèle Lueur | Modèle envoyé au fournisseur |
| --- | --- | --- |
| Local | Qwen3.5 4B Vision, Gemma 3 4B Vision, Phi-4 Mini, Llama 3.2, SmolLM3, DeepSeek R1 1.5B, Qwen2.5 Coder | GGUF via llama.cpp |
| GroqCloud | GPT-OSS 120B | `openai/gpt-oss-120b` |
| GroqCloud | Qwen 3.8 27B | `qwen/qwen3.8-27b` |
| Google Gemini | Gemini 3.8 Flash | `gemini-3.8-flash` |
| Mistral AI | Mistral Small | `mistral-small-latest` |
| OpenRouter | OpenRouter Free | `openrouter/free` |
| Cloudflare Workers AI | GPT-OSS 120B | `@cf/openai/gpt-oss-120b` |
| Hugging Face | DeepSeek R1 | `deepseek-ai/DeepSeek-R1:fastest` |
| NVIDIA NIM | GPT-OSS 120B | `openai/gpt-oss-120b` |
| NVIDIA NIM | DeepSeek V4 Flash | `deepseek-ai/deepseek-v4-flash` |
| NVIDIA NIM | Qwen3 Next 80B A3B | `qwen/qwen3-next-80b-a3b-instruct` |
| Cohere | Command A+ | `command-a-plus-05-2026` |
| Vercel AI Gateway | Ling 3.0 Flash VL Free | `inclusionai/ling-3.0-flash-vl` |

Le navigateur continue à appeler uniquement le router Lueur. Celui-ci choisit automatiquement le bon fournisseur à partir du modèle sélectionné, conserve le streaming SSE et garde la génération en arrière-plan lorsque le navigateur est fermé. Les clés restent côté Termux ; ne les ajoutez jamais au dépôt.

Pour vérifier les fournisseurs configurés :

```bash
curl http://127.0.0.1:8080/providers
```

Pour tout arrêter :

```bash
~/start-ai.sh stop
```

## Android / Termux : router multi-modèles

Le router officiel de `llama-server` dépend de `LLAMA_SUBPROCESS`. Ce support est désactivé par défaut sur Android et ne compile pas actuellement sur Bionic/Termux à cause de `posix_spawn_file_actions_addchdir_np`.

Lueur utilise donc `scripts/model-router.py`, un petit router HTTP Python compatible Termux :

```text
ngrok / Lueur :8080
        ↓
router Python
   ┌────┴───────────────────────────────────────────────┐
   ↓                                                    ↓
llama-server :8081                            APIs cloud sécurisées
   ↓                                  Groq / Gemini / Mistral / OpenRouter
1 GGUF local à la fois                 Workers AI / Hugging Face
                                       NVIDIA / Cohere / Vercel AI Gateway
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

Le router lit le champ OpenAI `model`. Pour un modèle local, il charge automatiquement le GGUF demandé et libère le précédent. Pour un modèle cloud, il garde le modèle local chargé (déchargé après `LUEUR_IDLE_UNLOAD` secondes d'inactivité, ou tout de suite avec `LUEUR_CLOUD_UNLOAD=1`), remplace l'identifiant Lueur par l'identifiant du fournisseur et relaie la requête HTTPS/SSE avec la clé conservée dans Termux.

## Modèles texte de test

Les modèles texte supplémentaires sont chargés à la demande par le router :

- `bartowski/microsoft_Phi-4-mini-instruct-GGUF:Q4_K_M`
- `bartowski/Llama-3.2-3B-Instruct-GGUF:Q4_K_M`
- `bartowski/HuggingFaceTB_SmolLM3-3B-GGUF:Q4_K_M`
- `bartowski/DeepSeek-R1-Distill-Qwen-1.5B-GGUF:Q4_K_M`
- `bartowski/Qwen2.5-Coder-3B-Instruct-GGUF:Q4_K_M`

Le premier appel à un modèle non encore présent dans le cache déclenche son téléchargement. Un seul modèle est chargé en RAM à la fois.


## Cloudflare Worker : application + API

L’adresse principale de Lueur est **https://chat.testcivique.workers.dev/**.
Le Worker sert à la fois l’application (build Vite dans `dist/`, via Workers Static Assets)
et l’API sur la même origine, donc sans CORS ni URL à configurer.
GitHub Pages (`https://brahmiamine.github.io/chat/`) reste disponible et utilise ce même Worker comme API.

```text
https://chat.testcivique.workers.dev/      → application Lueur (dist/)
https://chat.testcivique.workers.dev/v1/…  → API
        ├── Groq / Gemini / Mistral / OpenRouter
        ├── Cloudflare Workers AI / Hugging Face
        ├── NVIDIA NIM / Cohere / Vercel AI Gateway
        └── LUEUR_LOCAL_URL → ngrok → Termux → llama.cpp
```

Le Worker se trouve dans `worker/index.js` et son déploiement est décrit par `wrangler.jsonc`.
Le projet Cloudflare connecté au dépôt peut utiliser le déploiement par défaut `npx wrangler deploy` :
`wrangler.jsonc` lance `npm run build` avant chaque déploiement et publie `dist/` comme assets.
Seules les routes API (`/api`, `/health`, `/providers`, `/models`, `/props`, `/v1/*`) exécutent le script ;
tout le reste est servi comme fichier statique, avec `index.html` en repli.
`keep_vars: true` conserve les variables créées dans le dashboard lors des déploiements Wrangler. Les secrets Cloudflare sont également conservés par Wrangler.

Variables non sensibles à configurer dans **Workers & Pages → chat → Settings → Variables and secrets** :

```text
CLOUDFLARE_ACCOUNT_ID
LUEUR_LOCAL_URL=https://expansile-ramiro-intertribal.ngrok-free.dev
```

Secrets à configurer comme **Secret** et jamais comme variable publique Vite :

```text
GROQ_API_KEY
GEMINI_API_KEY
MISTRAL_API_KEY
OPENROUTER_API_KEY
HF_TOKEN
NVIDIA_API_KEY
COHERE_API_KEY
AI_GATEWAY_API_KEY
CLOUDFLARE_AI_API_TOKEN
```

Le Worker expose :

```text
GET  /api
GET  /health
GET  /providers
GET  /models
GET  /v1/models
GET  /props
POST /v1/chat/completions
```

Le CORS autorise par défaut la propre origine du Worker, `https://brahmiamine.github.io` ainsi que localhost pour le développement.
Des origines supplémentaires peuvent être ajoutées avec la variable `LUEUR_ALLOWED_ORIGIN` (liste séparée par des virgules).

Par défaut, les POST sans en-tête `Origin` sont refusés afin d'éviter de transformer le Worker en proxy totalement ouvert.
Pour un test ponctuel avec curl, ajoutez par exemple :

```bash
-H 'Origin: https://brahmiamine.github.io'
```

ou définissez temporairement `LUEUR_ALLOW_DIRECT=1`. Cette protection limite les abus simples mais ne remplace pas une authentification forte ; pour une application privée, ajoutez Cloudflare Access.

Quand Lueur est ouverte directement via ngrok, elle continue d'utiliser le router Termux en same-origin. Quand elle est ouverte depuis GitHub Pages, elle utilise le Worker Cloudflare.
