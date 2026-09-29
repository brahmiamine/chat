#!/data/data/com.termux/files/usr/bin/bash
# Lueur + llama.cpp router + Cloudflare Tunnel
#
# Modèles :
#   - Qwen3.5 4B Vision Q4_K_M
#   - Gemma 3 4B Vision Q4_K_M
#
# Le routeur ne garde qu'un modèle chargé à la fois (--models-max 1),
# ce qui est adapté à un téléphone d'environ 10 Go de RAM.
#
# Usage :
#   ~/start-ai.sh
#   ~/start-ai.sh restart
#   ~/start-ai.sh stop

QWEN_MODEL="lmstudio-community/Qwen3.5-4B-GGUF:Q4_K_M"
GEMMA_MODEL="ggml-org/gemma-3-4b-it-GGUF:Q4_K_M"
PHI_MODEL="bartowski/microsoft_Phi-4-mini-instruct-GGUF:Q4_K_M"
LLAMA_MODEL="bartowski/Llama-3.2-3B-Instruct-GGUF:Q4_K_M"
SMOL_MODEL="bartowski/HuggingFaceTB_SmolLM3-3B-GGUF:Q4_K_M"
DEEPSEEK_MODEL="bartowski/DeepSeek-R1-Distill-Qwen-1.5B-GGUF:Q4_K_M"
CODER_MODEL="bartowski/Qwen2.5-Coder-3B-Instruct-GGUF:Q4_K_M"

PORT=8080
CTX=4096
UI_DIR="$HOME/lueur-ui"
LLAMA_DIR="$HOME/llama.cpp"
PRESET_FILE="$HOME/lueur-models.ini"
SERVER_LOG="$HOME/llama-server.log"
TUNNEL_LOG="$HOME/cloudflared.log"
URL_FILE="$HOME/ai-url.txt"

LS_PAT='(^|/)llama-server( |$)'
CF_PAT='(^|/)cloudflared tunnel'

health_ok() { curl -fsS -m 3 "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; }
ui_ok() { curl -s -m 3 "http://127.0.0.1:$PORT/" | grep -q '<title>Lueur</title>'; }
server_running() { pgrep -f "$LS_PAT" >/dev/null; }
tunnel_running() { pgrep -f "$CF_PAT" >/dev/null; }
tunnel_url() { grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$TUNNEL_LOG" 2>/dev/null | tail -1; }

stop_proc() {
  pkill -f "$1" 2>/dev/null || return 0
  for _ in $(seq 1 15); do
    pgrep -f "$1" >/dev/null || return 0
    sleep 1
  done
  pkill -9 -f "$1" 2>/dev/null
  sleep 1
}

stop_all() {
  stop_proc "$LS_PAT"
  stop_proc "$CF_PAT"
}

case "${1:-}" in
  stop)
    stop_all
    echo "🛑 Routeur IA et tunnel arrêtés"
    exit 0
    ;;
  restart)
    stop_all
    ;;
esac

command -v termux-wake-lock >/dev/null && termux-wake-lock 2>/dev/null || true

# --- Interface Lueur ---
if [ -d "$UI_DIR/.git" ]; then
  if git -C "$UI_DIR" fetch -q --depth 1 origin dist 2>/dev/null     && git -C "$UI_DIR" reset -q --hard FETCH_HEAD; then
    echo "🎨 Interface à jour"
  else
    echo "⚠️  Mise à jour de l'interface impossible (version locale conservée)"
  fi
else
  echo "🎨 Téléchargement de l'interface..."
  git clone -q -b dist --depth 1 https://github.com/brahmiamine/chat "$UI_DIR"     || echo "⚠️  Interface non téléchargée (l'API fonctionnera quand même)"
fi

# --- Presets du router ---
cat > "$PRESET_FILE" <<EOF
version = 1

[*]
c = $CTX
np = 1
jinja = true
load-on-startup = false
dedup-cache-models = true

[$QWEN_MODEL]
hf-repo = $QWEN_MODEL

[$GEMMA_MODEL]
hf-repo = $GEMMA_MODEL

[$PHI_MODEL]
hf-repo = $PHI_MODEL

[$LLAMA_MODEL]
hf-repo = $LLAMA_MODEL

[$SMOL_MODEL]
hf-repo = $SMOL_MODEL

[$DEEPSEEK_MODEL]
hf-repo = $DEEPSEEK_MODEL

[$CODER_MODEL]
hf-repo = $CODER_MODEL
EOF

# Remplace un ancien serveur mono-modèle par le router.
if server_running && ! pgrep -af "$LS_PAT" | grep -q -- "--models-preset"; then
  echo "♻️  Ancien serveur mono-modèle détecté, passage en mode router..."
  stop_proc "$LS_PAT"
fi

# --- llama.cpp router ---
if health_ok && server_running; then
  echo "✅ Router IA déjà actif"
elif server_running; then
  echo "⏳ Router déjà lancé..."
else
  echo "🤖 Démarrage du router multi-modèles..."
  cd "$LLAMA_DIR" || { echo "❌ Dossier $LLAMA_DIR introuvable"; exit 1; }

  : > "$SERVER_LOG"

  nohup ./build/bin/llama-server     --models-preset "$PRESET_FILE"     --models-max 1     --models-autoload     --host 127.0.0.1     --port "$PORT"     --path "$UI_DIR"     --cors-origins "https://brahmiamine.github.io"     > "$SERVER_LOG" 2>&1 &
fi

# --- Attendre que le router HTTP soit prêt ---
if ! health_ok; then
  echo "⏳ Initialisation du router..."
  for _ in $(seq 1 120); do
    health_ok && break
    if ! server_running; then
      echo "❌ llama-server s'est arrêté. Dernières lignes :"
      tail -n 30 "$SERVER_LOG"
      exit 1
    fi
    sleep 1
  done
fi

if ! health_ok; then
  echo "❌ Router non disponible après 2 minutes"
  tail -n 30 "$SERVER_LOG"
  exit 1
fi

echo "✅ Router prêt"

# --- Tunnel Cloudflare ---
if tunnel_running && [ -n "$(tunnel_url)" ]; then
  echo "🌐 Tunnel déjà actif"
else
  stop_proc "$CF_PAT"
  echo "🌐 Ouverture du tunnel Cloudflare..."
  : > "$TUNNEL_LOG"

  nohup cloudflared tunnel     --protocol http2     --url "http://127.0.0.1:$PORT"     > "$TUNNEL_LOG" 2>&1 &

  for _ in $(seq 1 30); do
    [ -n "$(tunnel_url)" ] && break
    sleep 1
  done
fi

ui_ok || echo "⚠️  L'interface Lueur n'est pas servie"

URL="$(tunnel_url)"

echo
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🤖 Modèles disponibles :"
echo "   1. Qwen3.5 4B Vision"
echo "   2. Gemma 3 4B Vision"
echo "   3. Phi-4 Mini 3.8B"
echo "   4. Llama 3.2 3B"
echo "   5. SmolLM3 3B"
echo "   6. DeepSeek R1 1.5B"
echo "   7. Qwen2.5 Coder 3B"
echo
echo "💾 Un seul modèle sera chargé en RAM à la fois."
echo "   Au premier choix d'un modèle, son téléchargement peut prendre plusieurs minutes."
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
else
  echo "⚠️ URL Cloudflare introuvable"
  echo "   tail -n 30 $TUNNEL_LOG"
fi

echo "📱 Local : http://127.0.0.1:$PORT"
echo
echo "Tester les modèles :"
echo "curl http://127.0.0.1:$PORT/models"
echo
echo "Logs :"
echo "tail -f $SERVER_LOG"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
