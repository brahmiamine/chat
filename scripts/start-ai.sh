#!/data/data/com.termux/files/usr/bin/bash
# Lueur + router Python Android + llama.cpp + ngrok via Debian proot
#
# Cette version utilise ngrok dans Debian/proot pour exposer Lueur en HTTPS.
# Le router Python garde un seul modèle GGUF local en RAM à la fois et peut
# aussi relayer Groq, Gemini, Mistral, OpenRouter, Workers AI, Cerebras et HF.
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

# Configuration persistante facultative dans ~/.lueur.env :
#   export LUEUR_NGROK_URL='https://mon-domaine.ngrok.app'
#
# Fournisseurs cloud (ajoutez uniquement ceux que vous utilisez) :
#   export GROQ_API_KEY='...'
#   export GEMINI_API_KEY='...'
#   export MISTRAL_API_KEY='...'
#   export OPENROUTER_API_KEY='...'
#   export CEREBRAS_API_KEY='...'
#   export HF_TOKEN='...'
#   export NVIDIA_API_KEY='...'
#   export COHERE_API_KEY='...'
#   export AI_GATEWAY_API_KEY='...'
#   export CLOUDFLARE_ACCOUNT_ID='...'
#   export CLOUDFLARE_AI_API_TOKEN='...'
#
# Les secrets restent sur le téléphone : ils ne sont ni envoyés au navigateur
# ni stockés dans GitHub.
#
# L'authtoken ngrok reste dans Debian/proot :
#   proot-distro login debian
#   ~/ngrok config add-authtoken TON_TOKEN
if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  . "$ENV_FILE"
fi

LUEUR_NGROK_URL="${LUEUR_NGROK_URL:-https://expansile-ramiro-intertribal.ngrok-free.dev}"

ROUTER_PAT='lueur-router\.py'
LS_PAT='(^|/)llama-server( |$)'
NGROK_PAT='ngrok .*http .*8080'
SERVEO_PAT='ssh .*serveo\.net'
LHR_PAT='ssh .*localhost\.run'
CF_PAT='(^|/)cloudflared( |$)'

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
  [ -n "$(tunnel_url)" ]
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

stop_ngrok() {
  # Arrête d'abord ngrok dans Debian/proot si disponible.
  if command -v proot-distro >/dev/null 2>&1; then
    proot-distro login debian -- sh -lc 'pkill -f "ngrok .*http .*8080" 2>/dev/null || true' \
      >/dev/null 2>&1 || true
  fi

  # Puis nettoie d'éventuels wrappers/procès restants côté Termux.
  stop_proc "$NGROK_PAT"
}

stop_all() {
  stop_proc "$ROUTER_PAT"
  stop_proc "$LS_PAT"

  # Nettoie le tunnel actuel ainsi que les anciennes solutions.
  stop_ngrok
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
    GROQ_API_KEY="${GROQ_API_KEY:-}" \
    GEMINI_API_KEY="${GEMINI_API_KEY:-}" \
    MISTRAL_API_KEY="${MISTRAL_API_KEY:-}" \
    OPENROUTER_API_KEY="${OPENROUTER_API_KEY:-}" \
    CEREBRAS_API_KEY="${CEREBRAS_API_KEY:-}" \
    HF_TOKEN="${HF_TOKEN:-}" \
    NVIDIA_API_KEY="${NVIDIA_API_KEY:-}" \
    COHERE_API_KEY="${COHERE_API_KEY:-}" \
    AI_GATEWAY_API_KEY="${AI_GATEWAY_API_KEY:-}" \
    CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-}" \
    CLOUDFLARE_AI_API_TOKEN="${CLOUDFLARE_AI_API_TOKEN:-}" \
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

# --- Tunnel ngrok via Debian/proot ---
if ! command -v proot-distro >/dev/null 2>&1; then
  echo "❌ proot-distro n'est pas installé."
  echo
  echo "Installe-le avec :"
  echo "  pkg install proot-distro -y"
  echo "  proot-distro install debian"
  exit 1
fi

if ! proot-distro login debian -- true >/dev/null 2>&1; then
  echo "❌ Le conteneur Debian proot n'est pas installé."
  echo
  echo "Installe-le avec :"
  echo "  proot-distro install debian"
  exit 1
fi

if ! proot-distro login debian -- test -x /root/ngrok >/dev/null 2>&1; then
  echo "❌ ngrok n'est pas installé dans Debian/proot."
  echo
  echo "Entre dans Debian et installe ngrok :"
  echo "  proot-distro login debian"
  echo "  apt update && apt install -y curl ca-certificates"
  echo "  cd /root"
  echo "  curl -fsSL https://bin.ngrok.com/c/bNyj1mQVY4c/ngrok-v3-stable-linux-arm64.tgz | tar -xz"
  echo "  chmod +x /root/ngrok"
  echo "  /root/ngrok config add-authtoken TON_TOKEN_NGROK"
  exit 1
fi

if tunnel_running; then
  echo "🌐 Tunnel ngrok déjà actif"
else
  stop_ngrok
  stop_proc "$SERVEO_PAT"
  stop_proc "$LHR_PAT"
  stop_proc "$CF_PAT"

  echo "🌐 Ouverture du tunnel ngrok via Debian/proot..."
  : > "$TUNNEL_LOG"

  nohup proot-distro login debian -- \
    /root/ngrok http "$PORT" \
      --url "$LUEUR_NGROK_URL" \
      --log=stdout \
      --log-format=json \
    > "$TUNNEL_LOG" 2>&1 &

  for _ in $(seq 1 40); do
    [ -n "$(tunnel_url)" ] && break
    sleep 1
  done

  if [ -z "$(tunnel_url)" ]; then
    echo "❌ ngrok n'est pas devenu disponible."
    echo "Dernières lignes :"
    tail -n 30 "$TUNNEL_LOG"
    echo
    echo "Vérifie que l'authtoken est bien configuré dans Debian :"
    echo "  proot-distro login debian"
    echo "  ~/ngrok config add-authtoken TON_TOKEN_NGROK"
    exit 1
  fi
fi

URL="$(tunnel_url)"

ui_ok || echo "⚠️  L'interface Lueur n'est pas servie"

echo
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🤖 Modèles disponibles :"
echo "   🏠 Local       : 7 modèles GGUF"
echo "   ⚡ Groq        : GPT-OSS 120B, Qwen 3.8 27B"
echo "   ✨ Gemini      : Gemini 3.8 Flash"
echo "   🇫🇷 Mistral    : Mistral Small"
echo "   🌐 OpenRouter  : Free Router"
echo "   ☁️ Workers AI  : GPT-OSS 120B"
echo "   🚀 Cerebras    : GPT-OSS 120B"
echo "   🤗 HuggingFace : DeepSeek R1"
echo "   🟢 NVIDIA NIM  : GPT-OSS 120B, DeepSeek V4 Flash, Qwen3 Next 80B"
echo "   🟣 Cohere      : Command A+"
echo "   ▲ Vercel      : Ling 3.0 Flash VL Free"
echo
echo "💾 Un seul modèle local est chargé en RAM à la fois."
echo "☁️ Les modèles cloud n'utilisent pas la RAM du téléphone pour l'inférence."
echo

PROVIDER_COUNT=0
[ -n "${GROQ_API_KEY:-}" ] && PROVIDER_COUNT=$((PROVIDER_COUNT + 1))
[ -n "${GEMINI_API_KEY:-}" ] && PROVIDER_COUNT=$((PROVIDER_COUNT + 1))
[ -n "${MISTRAL_API_KEY:-}" ] && PROVIDER_COUNT=$((PROVIDER_COUNT + 1))
[ -n "${OPENROUTER_API_KEY:-}" ] && PROVIDER_COUNT=$((PROVIDER_COUNT + 1))
[ -n "${CEREBRAS_API_KEY:-}" ] && PROVIDER_COUNT=$((PROVIDER_COUNT + 1))
[ -n "${HF_TOKEN:-}" ] && PROVIDER_COUNT=$((PROVIDER_COUNT + 1))
[ -n "${NVIDIA_API_KEY:-}" ] && PROVIDER_COUNT=$((PROVIDER_COUNT + 1))
[ -n "${COHERE_API_KEY:-}" ] && PROVIDER_COUNT=$((PROVIDER_COUNT + 1))
[ -n "${AI_GATEWAY_API_KEY:-}" ] && PROVIDER_COUNT=$((PROVIDER_COUNT + 1))
if [ -n "${CLOUDFLARE_ACCOUNT_ID:-}" ] && [ -n "${CLOUDFLARE_AI_API_TOKEN:-}" ]; then
  PROVIDER_COUNT=$((PROVIDER_COUNT + 1))
fi
echo "🔐 Fournisseurs cloud configurés : $PROVIDER_COUNT/10"
echo "   Configuration : $ENV_FILE"
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
