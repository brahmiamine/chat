#!/data/data/com.termux/files/usr/bin/bash
# Démarre llama-server (qui sert aussi l'interface Lueur) + un tunnel Cloudflare,
# puis affiche l'URL publique. Relançable sans risque : réutilise ce qui tourne déjà.
#
# Usage : ~/start-ai.sh            démarrer / afficher l'URL
#         ~/start-ai.sh restart    tout redémarrer
#         ~/start-ai.sh stop       tout arrêter

MODEL="mradermacher/Qwen3-4B-Instruct-2507-GGUF:Q4_K_M"
PORT=8080
CTX=4096
UI_DIR="$HOME/lueur-ui"
LLAMA_DIR="$HOME/llama.cpp"
SERVER_LOG="$HOME/llama-server.log"
TUNNEL_LOG="$HOME/cloudflared.log"
URL_FILE="$HOME/ai-url.txt"

# Recherche par ligne de commande (le nom du processus peut différer sur Android)
LS_PAT='(^|/)llama-server( |$)'
CF_PAT='(^|/)cloudflared tunnel'

health_ok() { curl -s -m 3 "http://127.0.0.1:$PORT/health" | grep -q '"ok"'; }
ui_ok() { curl -s -m 3 "http://127.0.0.1:$PORT/" | grep -q '<title>Lueur</title>'; }
server_running() { pgrep -f "$LS_PAT" >/dev/null; }
tunnel_running() { pgrep -f "$CF_PAT" >/dev/null; }

# Arrête un processus et attend qu'il soit vraiment terminé (15 s max, puis kill -9)
stop_proc() {
  pkill -f "$1" 2>/dev/null || return 0
  for _ in $(seq 1 15); do pgrep -f "$1" >/dev/null || return 0; sleep 1; done
  pkill -9 -f "$1" 2>/dev/null; sleep 1
}
tunnel_url() { grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$TUNNEL_LOG" 2>/dev/null | tail -1; }

stop_all() {
  stop_proc "$LS_PAT"
  stop_proc "$CF_PAT"
}

case "$1" in
  stop) stop_all; echo "🛑 Serveur IA et tunnel arrêtés"; exit 0 ;;
  restart) stop_all ;;
esac

# Empêche Android de mettre Termux en veille (si Termux:API est installé)
command -v termux-wake-lock >/dev/null && termux-wake-lock

# --- Interface web (branche dist du dépôt) ---
if [ -d "$UI_DIR/.git" ]; then
  if git -C "$UI_DIR" pull -q --ff-only 2>/dev/null; then echo "🎨 Interface à jour"
  else echo "⚠️  Mise à jour de l'interface impossible (version locale conservée)"; fi
else
  echo "🎨 Téléchargement de l'interface..."
  git clone -q -b dist --depth 1 https://github.com/brahmiamine/chat "$UI_DIR" || echo "⚠️  Interface non téléchargée (l'API fonctionnera quand même)"
fi

# --- llama-server ---
# Un serveur qui ne sert pas l'interface Lueur (lancé sans --path) est remplacé.
if health_ok && ! ui_ok; then
  echo "♻️  Serveur sans l'interface Lueur détecté, redémarrage..."
  stop_proc "$LS_PAT"
  if health_ok; then
    echo "❌ Impossible d'arrêter l'ancien serveur. Processus :"
    ps -eo pid,args | grep -i llama | grep -v grep
    exit 1
  fi
fi

if health_ok; then
  echo "✅ Serveur IA déjà actif"
elif server_running; then
  echo "⏳ Serveur déjà lancé, modèle en cours de chargement..."
else
  echo "🤖 Démarrage de Qwen..."
  cd "$LLAMA_DIR" || { echo "❌ Dossier $LLAMA_DIR introuvable"; exit 1; }
  nohup ./build/bin/llama-server \
    -hf "$MODEL" \
    --host 0.0.0.0 \
    --port "$PORT" \
    -c "$CTX" \
    --path "$UI_DIR" \
    --cors-origins "*" \
    > "$SERVER_LOG" 2>&1 &
fi

# --- Tunnel Cloudflare (démarré en parallèle du chargement du modèle) ---
if tunnel_running && [ -n "$(tunnel_url)" ]; then
  echo "🌐 Tunnel déjà actif"
else
  stop_proc "$CF_PAT"
  echo "🌐 Ouverture du tunnel Cloudflare..."
  : > "$TUNNEL_LOG"
  nohup cloudflared tunnel --protocol http2 --url "http://127.0.0.1:$PORT" > "$TUNNEL_LOG" 2>&1 &
  for _ in $(seq 1 30); do
    [ -n "$(tunnel_url)" ] && break
    sleep 1
  done
fi

# --- Attente du modèle (le premier téléchargement -hf peut être long) ---
if ! health_ok; then
  echo "⏳ Chargement du modèle..."
  for _ in $(seq 1 600); do
    health_ok && break
    if ! server_running; then
      echo "❌ llama-server s'est arrêté. Dernières lignes de $SERVER_LOG :"
      tail -n 15 "$SERVER_LOG"
      exit 1
    fi
    sleep 1
  done
fi
health_ok && echo "✅ Modèle prêt"
ui_ok || echo "⚠️  L'interface Lueur n'est pas servie (vérifiez $UI_DIR/index.html)"

# --- URL ---
URL="$(tunnel_url)"
echo
if [ -n "$URL" ]; then
  echo "$URL" > "$URL_FILE"
  command -v termux-clipboard-set >/dev/null && echo -n "$URL" | termux-clipboard-set && CLIP=" (copiée dans le presse-papiers)"
  echo "🔗 Interface + API : $URL${CLIP:-}"
  echo "📱 Sur ce téléphone : http://127.0.0.1:$PORT"
  echo "   API OpenAI      : $URL/v1/chat/completions"
else
  echo "⚠️  URL du tunnel introuvable. Voir : tail -n 30 $TUNNEL_LOG"
  echo "📱 Sur ce téléphone : http://127.0.0.1:$PORT"
fi
