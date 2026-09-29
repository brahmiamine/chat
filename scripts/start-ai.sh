#!/data/data/com.termux/files/usr/bin/bash
# Lueur + router Python Android + llama.cpp + ngrok
#
# Cette version utilise ngrok pour exposer Lueur en HTTPS.
# Le router Python garde un seul llama-server / modèle chargé en RAM à la fois.
#
# Usage :
#   ~/start-ai.sh
#   ~/start-ai.sh restart
#   ~/start-ai.sh stop

PORT=8080
MODEL_PORT=8081
CTX=4096
THREADS="${LUEUR_THREADS:-4}"

UI_DIR="$HOME/lueur-ui"
LLAMA_DIR="$HOME/llama.cpp"
ROUTER_SCRIPT="$HOME/lueur-router.py"

ROUTER_LOG="$HOME/lueur-router.log"
MODEL_LOG="$HOME/llama-model.log"
TUNNEL_LOG="$HOME/ngrok.log"
URL_FILE="$HOME/ai-url.txt"
ENV_FILE="$HOME/.lueur.env"

# Configuration facultative :
#   export LUEUR_NGROK_URL='https://mon-domaine.ngrok.app'
# L'authtoken ngrok doit rester hors du dépôt :
#   ~/ngrok config add-authtoken TON_TOKEN
if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  . "$ENV_FILE"
fi

LUEUR_NGROK_URL="${LUEUR_NGROK_URL:-}"

ROUTER_PAT='lueur-router\.py'
LS_PAT='(^|/)llama-server( |$)'
NGROK_PAT='(^|/)ngrok( |$).*http( |$).*8080'
SERVEO_PAT='ssh .*serveo\.net'
LHR_PAT='ssh .*localhost\.run'
CF_PAT='(^|/)cloudflared( |$)'

if command -v ngrok >/dev/null 2>&1; then
  NGROK_BIN="$(command -v ngrok)"
elif [ -x "$HOME/ngrok" ]; then
  NGROK_BIN="$HOME/ngrok"
else
  NGROK_BIN=""
fi

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
  pgrep -f "$NGROK_PAT" >/dev/null 2>&1
}

tunnel_url() {
  curl -fsS -m 3 "http://127.0.0.1:4040/api/tunnels" 2>/dev/null | \
    python -c 'import json,sys
try:
    data=json.load(sys.stdin)
    urls=[t.get("public_url","") for t in data.get("tunnels",[]) if t.get("public_url","").startswith("https://")]
    print(urls[0] if urls else "")
except Exception:
    print("")' 2>/dev/null
}

public_health_ok() {
  local url="${1:-}"
  [ -n "$url" ] || return 1
  curl -fsS -m 10 "$url/health" 2>/dev/null | grep -q '"status"'
}

stop_proc() {
  pkill -f "$1" 2>/dev/null || return 0
  for _ in $(seq 1 15); do
    pgrep -f "$1" >/dev/null 2>&1 || return 0
    sleep 1
  done
  pkill -9 -f "$1" 2>/dev/null || true
  sleep 1
}

stop_all() {
  stop_proc "$ROUTER_PAT"
  stop_proc "$LS_PAT"

  # Nettoie le tunnel actuel ainsi que les anciennes solutions.
  stop_proc "$NGROK_PAT"
  stop_proc "$SERVEO_PAT"
  stop_proc "$LHR_PAT"
  stop_proc "$CF_PAT"
}

case "${1:-}" in
  stop)
    stop_all
    echo "🛑 Lueur, modèle IA et tunnels arrêtés"
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

# --- Tunnel ngrok ---
if [ -z "$NGROK_BIN" ]; then
  echo "❌ ngrok n'est pas installé."
  echo
  echo "Installation Termux ARM64 :"
  echo "  cd ~"
  echo "  curl -fsSL https://bin.ngrok.com/c/bNyj1mQVY4c/ngrok-v3-stable-linux-arm64.tgz | tar -xz"
  echo "  chmod +x ~/ngrok"
  echo
  echo "Puis ajoute ton authtoken :"
  echo "  ~/ngrok config add-authtoken TON_TOKEN_NGROK"
  exit 1
fi

if tunnel_running && [ -n "$(tunnel_url)" ]; then
  echo "🌐 Tunnel ngrok déjà actif"
else
  stop_proc "$NGROK_PAT"
  stop_proc "$SERVEO_PAT"
  stop_proc "$LHR_PAT"
  stop_proc "$CF_PAT"

  echo "🌐 Ouverture du tunnel ngrok..."
  : > "$TUNNEL_LOG"

  NGROK_ARGS=(http "$PORT" --log=stdout --log-format=json)
  if [ -n "$LUEUR_NGROK_URL" ]; then
    NGROK_ARGS+=(--url "$LUEUR_NGROK_URL")
  fi

  nohup "$NGROK_BIN" "${NGROK_ARGS[@]}" > "$TUNNEL_LOG" 2>&1 &

  for _ in $(seq 1 30); do
    [ -n "$(tunnel_url)" ] && break
    if ! tunnel_running; then
      echo "❌ ngrok s'est arrêté. Dernières lignes :"
      tail -n 30 "$TUNNEL_LOG"
      echo
      echo "Si l'authtoken n'est pas encore configuré :"
      echo "  $NGROK_BIN config add-authtoken TON_TOKEN_NGROK"
      exit 1
    fi
    sleep 1
  done
fi

URL="$(tunnel_url)"

ui_ok || echo "⚠️  L'interface Lueur n'est pas servie"

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

if [ -n "$URL" ]; then
  echo "$URL" > "$URL_FILE"
  CLIP=""
  if command -v termux-clipboard-set >/dev/null 2>&1; then
    echo -n "$URL" | termux-clipboard-set 2>/dev/null && CLIP=" (copiée)"
  fi

  echo "🔗 Lueur : $URL$CLIP"
  echo "🤖 API   : $URL/v1/chat/completions"
  echo "📦 Models: $URL/models"

  if public_health_ok "$URL"; then
    echo "✅ HTTPS ngrok vérifié"
  else
    echo "⚠️  ngrok est actif mais /health n'a pas répondu au test"
    echo "   Vérifie : curl -v $URL/health"
  fi
else
  echo "⚠️ URL ngrok introuvable"
  echo "   tail -n 30 $TUNNEL_LOG"
fi

echo "📱 Local : http://127.0.0.1:$PORT"
echo "🛠️ ngrok UI : http://127.0.0.1:4040"
echo
echo "Logs router : tail -f $ROUTER_LOG"
echo "Logs modèle : tail -f $MODEL_LOG"
echo "Logs tunnel : tail -f $TUNNEL_LOG"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
