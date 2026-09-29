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
llama-server -m Qwen3-4B-Instruct-2507-Q4_K_M.gguf --host 0.0.0.0 --port 8080 --ctx-size 8192
```

Serveur par défaut : `http://192.168.1.98:8080`. Vous pouvez le modifier dans **Paramètres → Connexion**, ou fixer d’autres valeurs initiales dans un fichier `.env.local` (voir `.env.example`).

> **HTTPS :** un navigateur bloque les appels d’une page HTTPS vers un serveur HTTP (*mixed content*). Servez l’application en HTTP sur le LAN, ou placez llama-server derrière un proxy HTTPS.

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
- Pièces jointes texte (+), mode démo hors ligne

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
├── lib/                 # fonctions pures (titres, historique, réglages, coloration)
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
