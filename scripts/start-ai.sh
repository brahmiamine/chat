#!/data/data/com.termux/files/usr/bin/bash
# Lueur + router Python Android + llama.cpp + Cloudflare Named Tunnel
#
# Le router officiel de llama.cpp dépend de LLAMA_SUBPROCESS, qui ne compile
# pas correctement sur Android/Bionic. Cette version utilise un petit router
# Python compatible Termux et garde un seul llama-server chargé à la fois.
#
# Usage :
#   ~/start-ai.sh
#   ~/start-ai.sh restart
#   ~/start-ai.sh stop

PORT=8080
MODEL_PORT=8081
CTX=4096
# Threads CPU pour llama-server (≈ nombre de cœurs performants du téléphone)
THREADS="${LUEUR_THREADS:-4}"

UI_DIR="$HOME/lueur-ui"
LLAMA_DIR="$HOME/llama.cpp"
ROUTER_SCRIPT="$HOME/lueur-router.py"

ROUTER_LOG="$HOME/lueur-router.log"
MODEL_LOG="$HOME/llama-model.log"
TUNNEL_LOG="$HOME/cloudflared.log"
URL_FILE="$HOME/ai-url.txt"
ENV_FILE="$HOME/.lueur.env"

# Configuration persistante facultative :
#   export CLOUDFLARE_TUNNEL_TOKEN='...'
#   export LUEUR_PUBLIC_URL='https://ai.example.com'
if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  . "$ENV_FILE"
fi

CLOUDFLARE_TUNNEL_TOKEN="${CLOUDFLARE_TUNNEL_TOKEN:-}"
LUEUR_PUBLIC_URL="${LUEUR_PUBLIC_URL:-}"

ROUTER_PAT='lueur-router\.py'
LS_PAT='(^|/)llama-server( |$)'
CF_PAT='(^|/)cloudflared tunnel .*run'

health_ok() {
  curl -fsS -m 3 "http://127.0.0.1:$PORT/health" >/dev/null 2>&1
}

ui_ok() {
  curl -s -m 3 "http://127.0.0.1:$PORT/" | grep -q '<title>Lueur</title>'
}

router_running() {
  pgrep -f "$ROUTER_PAT" >/dev/null 2>&1
}

tunnel_running() {
  pgrep -f "$CF_NAMED_PAT" >/dev/null 2>&1
}


stop_proc() {
  pkill -f "$1" 2>/dev/null || return 0
  for _ in $(seq 1 15); do
    pgrep -f "$1" >/dev/null || return 0
    sleep 1
  done
  pkill -9 -f "$1" 2>/dev/null || true
  sleep 1
}

stop_all() {
  # Le router arrête normalement son llama-server enfant.
  stop_proc "$ROUTER_PAT"
  stop_proc "$LS_PAT"
  stop_proc "$CF_PAT"
}

case "${1:-}" in
  stop)
    stop_all
    echo "🛑 Lueur, modèle IA et tunnel arrêtés"
    exit 0
    ;;
  restart)
    stop_all
    ;;
esac

command -v termux-wake-lock >/dev/null 2>&1 && termux-wake-lock 2>/dev/null || true

if ! command -v python >/dev/null 2>&1; then
  echo "❌ Python n'est pas installé dans Termux."
  echo "Installe-le avec :"
  echo "  pkg install python -y"
  exit 1
fi

if [ ! -x "$LLAMA_DIR/build/bin/llama-server" ]; then
  echo "❌ llama-server introuvable : $LLAMA_DIR/build/bin/llama-server"
  echo
  echo "Compile llama.cpp en mode Android normal :"
  echo "  cd $LLAMA_DIR"
  echo "  git pull --ff-only"
  echo "  rm -rf build"
  echo "  cmake -B build -DCMAKE_BUILD_TYPE=Release -DLLAMA_SUBPROCESS=OFF"
  echo "  cmake --build build -j2 --target llama-server"
  exit 1
fi

# --- Interface Lueur ---
if [ -d "$UI_DIR/.git" ]; then
  if git -C "$UI_DIR" fetch -q --depth 1 origin dist 2>/dev/null \
    && git -C "$UI_DIR" reset -q --hard FETCH_HEAD; then
    echo "🎨 Interface à jour"
  else
    echo "⚠️  Mise à jour de l'interface impossible (version locale conservée)"
  fi
else
  echo "🎨 Téléchargement de l'interface..."
  git clone -q -b dist --depth 1 https://github.com/brahmiamine/chat "$UI_DIR" \
    || { echo "❌ Interface non téléchargée"; exit 1; }
fi

# --- Router Python Android-compatible ---
echo "🧭 Mise à jour du router..."
if ! curl -fsSL https://raw.githubusercontent.com/brahmiamine/chat/main/scripts/model-router.py \
  -o "$ROUTER_SCRIPT"; then
  echo "❌ Impossible de télécharger le router"
  exit 1
fi
chmod +x "$ROUTER_SCRIPT"

if health_ok && router_running; then
  echo "✅ Router IA déjà actif"
else
  stop_proc "$ROUTER_PAT"
  stop_proc "$LS_PAT"

  echo "🤖 Démarrage du router multi-modèles Android..."
  : > "$ROUTER_LOG"

  nohup env \
    LUEUR_ROUTER_HOST=127.0.0.1 \
    LUEUR_ROUTER_PORT="$PORT" \
    LUEUR_MODEL_PORT="$MODEL_PORT" \
    LUEUR_CTX="$CTX" \
    LUEUR_THREADS="$THREADS" \
    LUEUR_THINKING="${LUEUR_THINKING:-0}" \
    LUEUR_UI_DIR="$UI_DIR" \
    LUEUR_LLAMA_DIR="$LLAMA_DIR" \
    LUEUR_MODEL_LOG="$MODEL_LOG" \
    python "$ROUTER_SCRIPT" \
    > "$ROUTER_LOG" 2>&1 &

  echo "⏳ Initialisation du router..."
  for _ in $(seq 1 60); do
    health_ok && break
    if ! router_running; then
      echo "❌ Le router s'est arrêté. Dernières lignes :"
      tail -n 30 "$ROUTER_LOG"
      exit 1
    fi
    sleep 1
  done
fi

if ! health_ok; then
  echo "❌ Router non disponible"
  tail -n 30 "$ROUTER_LOG"
  exit 1
fi

echo "✅ Router prêt"

# --- Cloudflare Named Tunnel ---
# Les Quick Tunnels trycloudflare.com ne supportent pas correctement SSE.
# Le tunnel nommé utilise un hostname stable configuré dans Cloudflare et
# relaie correctement le streaming de Lueur.
TUNNEL_ACTIVE=0

if [ -n "$CLOUDFLARE_TUNNEL_TOKEN" ]; then
  if tunnel_running; then
    echo "🌐 Cloudflare Named Tunnel déjà actif"
    TUNNEL_ACTIVE=1
  else
    stop_proc "$CF_PAT"
    echo "🌐 Ouverture du Cloudflare Named Tunnel..."
    : > "$TUNNEL_LOG"

    nohup cloudflared tunnel \
      --protocol auto \
      run \
      --token "$CLOUDFLARE_TUNNEL_TOKEN" \
      > "$TUNNEL_LOG" 2>&1 &

    for _ in $(seq 1 30); do
      if tunnel_running && grep -Eq 'Registered tunnel connection|Connection .* registered|INF.*Registered' "$TUNNEL_LOG" 2>/dev/null; then
        TUNNEL_ACTIVE=1
        break
      fi
      if ! tunnel_running; then
        break
      fi
      sleep 1
    done

    # Certaines versions de cloudflared changent le texte des logs :
    # si le processus tourne encore après l'attente, on considère le tunnel actif.
    tunnel_running && TUNNEL_ACTIVE=1
  fi
else
  echo "⚠️  Cloudflare Named Tunnel non configuré."
  echo "   Le mode local reste disponible."
  echo "   Configure $ENV_FILE avec CLOUDFLARE_TUNNEL_TOKEN."
fi

ui_ok || echo "⚠️  L'interface Lueur n'est pas servie"

URL="$LUEUR_PUBLIC_URL"

echo
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🤖 7 modèles disponibles :"
echo "   1. Qwen3.5 4B Vision"
echo "   2. Gemma 3 4B Vision"
echo "   3. Phi-4 Mini 3.8B"
echo "   4. Llama 3.2 3B"
echo "   5. SmolLM3 3B"
echo "   6. DeepSeek R1 1.5B"
echo "   7. Qwen2.5 Coder 3B"
echo
echo "💾 Un seul modèle est chargé en RAM à la fois."
echo "📥 Le premier appel à un modèle peut déclencher son téléchargement."
echo

if [ "$TUNNEL_ACTIVE" = "1" ] && [ -n "$URL" ]; then
  URL="${URL%/}"
  echo "$URL" > "$URL_FILE"
  CLIP=""
  if command -v termux-clipboard-set >/dev/null 2>&1; then
    echo -n "$URL" | termux-clipboard-set 2>/dev/null && CLIP=" (copiée)"
  fi

  echo "🔗 Lueur : $URL$CLIP"
  echo "🤖 API   : $URL/v1/chat/completions"
  echo "📦 Models: $URL/models"
elif [ "$TUNNEL_ACTIVE" = "1" ]; then
  echo "✅ Cloudflare Named Tunnel actif"
  echo "⚠️  Ajoute LUEUR_PUBLIC_URL dans $ENV_FILE pour afficher ton hostname."
else
  echo "🌐 Public : désactivé (Named Tunnel non configuré)"
fi

echo "📱 Local : http://127.0.0.1:$PORT"
echo
echo "Logs router : tail -f $ROUTER_LOG"
echo "Logs modèle : tail -f $MODEL_LOG"
echo "Logs tunnel : tail -f $TUNNEL_LOG"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
