#!/data/data/com.termux/files/usr/bin/bash
# Lueur + router Python Android + Snapdragon NPU local models + ngrok via Debian proot
#
# Cette version utilise ngrok dans Debian/proot pour exposer Lueur en HTTPS.
# Les modèles Q4_0 locaux tournent sur Snapdragon Hexagon HTP0.
# Un seul modèle local est chargé à la fois, et il est déchargé après
# LUEUR_IDLE_UNLOAD secondes d'inactivité.
# Les modèles manquants sont téléchargés en arrière-plan : le démarrage n'attend pas.
# Un superviseur relance automatiquement le router et le tunnel s'ils tombent.
#
# Usage :
#   ~/start-ai.sh            démarre (ou vérifie) tout
#   ~/start-ai.sh restart    arrête puis redémarre tout
#   ~/start-ai.sh stop       arrête tout
#   ~/start-ai.sh status     affiche l'état
#   ~/start-ai.sh boot       démarrage automatique au boot (app Termux:Boot)

PORT=8080
MODEL_PORT=8081
CTX=4096
THREADS="${LUEUR_THREADS:-6}"

UI_DIR="$HOME/lueur-ui"
LLAMA_DIR="$HOME/llama.cpp"
SNAP_LLAMA_DIR="${LUEUR_SNAP_LLAMA_DIR:-$HOME/llama-snapdragon}"
MODEL_DIR="${LUEUR_MODEL_DIR:-$HOME/models}"
DEFAULT_LOCAL_MODEL_ID="${LUEUR_DEFAULT_MODEL:-local::qwen2.5-7b-instruct-q4_0}"
ROUTER_SCRIPT="$HOME/lueur-router.py"
ROUTER_URL="https://raw.githubusercontent.com/brahmiamine/chat/main/scripts/model-router.py"

ROUTER_LOG="$HOME/lueur-router.log"
MODEL_LOG="$HOME/llama-model.log"
DOWNLOAD_LOG="$HOME/lueur-model-download.log"
PREFETCH_LOG="$HOME/lueur-prefetch.log"
TUNNEL_LOG="$HOME/ngrok.log"
SUPERVISOR_LOG="$HOME/lueur-supervisor.log"
URL_FILE="$HOME/ai-url.txt"
ENV_FILE="$HOME/.lueur.env"

SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"

# Configuration persistante facultative dans ~/.lueur.env :
#   export LUEUR_NGROK_URL='https://mon-domaine.ngrok.app'
#   export LUEUR_PREFETCH=all        # all | default | none (modèles pré-téléchargés)
#   export LUEUR_IDLE_UNLOAD=600     # secondes avant de décharger le modèle local (0 = jamais)
#   export LUEUR_CLOUD_UNLOAD=0      # 1 = décharger le modèle local dès qu'un modèle cloud sert
#   export LUEUR_SUPERVISE=1         # 0 = pas de relance automatique
#
# Fournisseurs cloud (ajoutez uniquement ceux que vous utilisez) :
#   export GROQ_API_KEY='...'
#   export GEMINI_API_KEY='...'
#   export MISTRAL_API_KEY='...'
#   export OPENROUTER_API_KEY='...'
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
  # Le fichier contient des clés API : lisible par ce seul utilisateur.
  chmod 600 "$ENV_FILE" 2>/dev/null || true
  # shellcheck disable=SC1090
  . "$ENV_FILE"
fi

LUEUR_NGROK_URL="${LUEUR_NGROK_URL:-https://expansile-ramiro-intertribal.ngrok-free.dev}"
LUEUR_PREFETCH="${LUEUR_PREFETCH:-all}"
LUEUR_IDLE_UNLOAD="${LUEUR_IDLE_UNLOAD:-600}"
LUEUR_CLOUD_UNLOAD="${LUEUR_CLOUD_UNLOAD:-0}"
LUEUR_SUPERVISE="${LUEUR_SUPERVISE:-1}"
SUPERVISE_INTERVAL=30
LOG_MAX_BYTES=5242880

# Le router principal est lancé sans argument ; `--download` est le
# pré-téléchargement, qui ne doit pas être confondu avec lui.
ROUTER_PAT='lueur-router\.py$'
PREFETCH_PAT='lueur-router\.py --download'
MODEL_CURL_PAT='curl .*\.gguf\.part'
SUPERVISOR_PAT="$(basename "$0" | sed 's/\./\\./g') supervise"
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

supervisor_running() {
  pgrep -f "$SUPERVISOR_PAT" >/dev/null 2>&1
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

log_line() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

# Garde une génération précédente du journal (.1) au lieu de l'effacer.
rotate_log() {
  [ -s "$1" ] && mv -f "$1" "$1.1"
  : > "$1"
}

# Pour un journal ouvert en ajout par un processus vivant : copie puis vide.
trim_log() {
  local size
  [ -f "$1" ] || return 0
  size="$(wc -c < "$1")"
  if [ "${size:-0}" -gt "$LOG_MAX_BYTES" ]; then
    cp -f "$1" "$1.1" && : > "$1"
  fi
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

stop_tunnels() {
  # Nettoie le tunnel actuel ainsi que les anciennes solutions.
  stop_ngrok
  stop_proc "$SERVEO_PAT"
  stop_proc "$LHR_PAT"
  stop_proc "$CF_PAT"
}

stop_all() {
  # Le superviseur d'abord, sinon il relancerait ce qu'on arrête.
  stop_proc "$SUPERVISOR_PAT"
  stop_proc "$PREFETCH_PAT"
  stop_proc "$ROUTER_PAT"
  stop_proc "$LS_PAT"
  # curl continue sinon d'écrire le .part après la mort du router.
  stop_proc "$MODEL_CURL_PAT"
  stop_tunnels
}

start_router() {
  stop_proc "$ROUTER_PAT"
  rotate_log "$ROUTER_LOG"

  nohup env \
    LUEUR_ROUTER_HOST=127.0.0.1 \
    LUEUR_ROUTER_PORT="$PORT" \
    LUEUR_MODEL_PORT="$MODEL_PORT" \
    LUEUR_CTX="$CTX" \
    LUEUR_THREADS="$THREADS" \
    LUEUR_THINKING="${LUEUR_THINKING:-0}" \
    LUEUR_IDLE_UNLOAD="$LUEUR_IDLE_UNLOAD" \
    LUEUR_CLOUD_UNLOAD="$LUEUR_CLOUD_UNLOAD" \
    LUEUR_UI_DIR="$UI_DIR" \
    LUEUR_LLAMA_DIR="$LLAMA_DIR" \
    LUEUR_SNAP_LLAMA_DIR="$SNAP_LLAMA_DIR" \
    LUEUR_MODEL_DIR="$MODEL_DIR" \
    LUEUR_MODEL_LOG="$MODEL_LOG" \
    LUEUR_DOWNLOAD_LOG="$DOWNLOAD_LOG" \
    LUEUR_DEFAULT_MODEL="$DEFAULT_LOCAL_MODEL_ID" \
    GROQ_API_KEY="${GROQ_API_KEY:-}" \
    GEMINI_API_KEY="${GEMINI_API_KEY:-}" \
    MISTRAL_API_KEY="${MISTRAL_API_KEY:-}" \
    OPENROUTER_API_KEY="${OPENROUTER_API_KEY:-}" \
    HF_TOKEN="${HF_TOKEN:-}" \
    NVIDIA_API_KEY="${NVIDIA_API_KEY:-}" \
    COHERE_API_KEY="${COHERE_API_KEY:-}" \
    AI_GATEWAY_API_KEY="${AI_GATEWAY_API_KEY:-}" \
    CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-}" \
    CLOUDFLARE_AI_API_TOKEN="${CLOUDFLARE_AI_API_TOKEN:-}" \
    python "$ROUTER_SCRIPT" \
    >> "$ROUTER_LOG" 2>&1 &

  for _ in $(seq 1 60); do
    health_ok && return 0
    if ! router_running; then
      echo "❌ Le router s'est arrêté. Dernières lignes :"
      tail -n 30 "$ROUTER_LOG"
      return 1
    fi
    sleep 1
  done

  health_ok || {
    echo "❌ Router non disponible"
    tail -n 30 "$ROUTER_LOG"
    return 1
  }
}

start_tunnel() {
  stop_tunnels
  rotate_log "$TUNNEL_LOG"

  nohup proot-distro login debian -- \
    /root/ngrok http "$PORT" \
      --url "$LUEUR_NGROK_URL" \
      --log=stdout \
      --log-format=json \
    >> "$TUNNEL_LOG" 2>&1 &

  for _ in $(seq 1 40); do
    [ -n "$(tunnel_url)" ] && return 0
    sleep 1
  done

  echo "❌ ngrok n'est pas devenu disponible."
  echo "Dernières lignes :"
  tail -n 30 "$TUNNEL_LOG"
  echo
  echo "Vérifie que l'authtoken est bien configuré dans Debian :"
  echo "  proot-distro login debian"
  echo "  ~/ngrok config add-authtoken TON_TOKEN_NGROK"
  return 1
}

# Pré-téléchargement en arrière-plan. La liste des modèles vient du router
# (source unique) et un verrou par fichier évite tout conflit avec un
# téléchargement à la demande lancé par le router.
start_prefetch() {
  case "$LUEUR_PREFETCH" in
    none|0) return 0 ;;
  esac
  pgrep -f "$PREFETCH_PAT" >/dev/null 2>&1 && return 0

  echo "⬇️  Modèles locaux ($LUEUR_PREFETCH) : vérification/téléchargement en arrière-plan"
  echo "💽 Espace disponible : $(df -h "$MODEL_DIR" 2>/dev/null | awk 'NR==2 {print $4}')"
  nohup env \
    LUEUR_MODEL_DIR="$MODEL_DIR" \
    LUEUR_DOWNLOAD_LOG="$DOWNLOAD_LOG" \
    LUEUR_DEFAULT_MODEL="$DEFAULT_LOCAL_MODEL_ID" \
    python "$ROUTER_SCRIPT" --download "$LUEUR_PREFETCH" \
    >> "$PREFETCH_LOG" 2>&1 &
}

supervise() {
  local router_fails=0
  local tunnel_fails=0

  log_line "Superviseur démarré (vérification toutes les ${SUPERVISE_INTERVAL}s)"
  while true; do
    sleep "$SUPERVISE_INTERVAL"

    if router_running && health_ok; then
      router_fails=0
    else
      router_fails=$((router_fails + 1))
      # /health ne bloque plus pendant un chargement : 3 échecs d'affilée
      # (~90 s) signifient vraiment que le router est tombé.
      if [ "$router_fails" -ge 3 ]; then
        log_line "Router indisponible, redémarrage..."
        if start_router; then
          log_line "Router relancé"
        else
          log_line "Échec de la relance du router"
        fi
        router_fails=0
      fi
    fi

    if tunnel_running; then
      tunnel_fails=0
    else
      tunnel_fails=$((tunnel_fails + 1))
      if [ "$tunnel_fails" -ge 2 ]; then
        log_line "Tunnel ngrok indisponible, redémarrage..."
        if start_tunnel; then
          log_line "Tunnel relancé : $(tunnel_url)"
        else
          log_line "Échec de la relance du tunnel"
        fi
        tunnel_fails=0
      fi
    fi

    trim_log "$ROUTER_LOG"
    trim_log "$TUNNEL_LOG"
    trim_log "$PREFETCH_LOG"
    trim_log "$DOWNLOAD_LOG"
    trim_log "$SUPERVISOR_LOG"
  done
}

start_supervisor() {
  [ "$LUEUR_SUPERVISE" = "1" ] || return 0
  supervisor_running && return 0
  nohup bash "$SELF" supervise >> "$SUPERVISOR_LOG" 2>&1 &
}

install_boot() {
  local boot_dir="$HOME/.termux/boot"
  local boot_file="$boot_dir/start-lueur"
  mkdir -p "$boot_dir"
  cat > "$boot_file" <<EOF
#!/data/data/com.termux/files/usr/bin/sh
# Généré par start-ai.sh boot : lance Lueur au démarrage du téléphone.
termux-wake-lock
exec bash "$SELF" > "\$HOME/lueur-boot.log" 2>&1
EOF
  chmod +x "$boot_file"
  echo "✅ Démarrage automatique installé : $boot_file"
  echo "   Installe l'app Termux:Boot (F-Droid) et ouvre-la une fois pour l'activer."
}

print_status() {
  if health_ok; then
    curl -fsS -m 3 "http://127.0.0.1:$PORT/health" | python -c 'import json,sys
d=json.load(sys.stdin)
print("✅ Router actif")
print("   Modèle local chargé :", d.get("active_model") or "aucun")
if d.get("loading_model"):
    print("   Chargement en cours :", d["loading_model"])'
  else
    echo "❌ Router indisponible"
  fi
  local url
  url="$(tunnel_url)"
  if [ -n "$url" ]; then echo "✅ Tunnel : $url"; else echo "❌ Tunnel inactif"; fi
  if supervisor_running; then echo "✅ Superviseur actif"; else echo "⚪ Superviseur arrêté"; fi
  if pgrep -f "$PREFETCH_PAT" >/dev/null 2>&1; then
    echo "⬇️  Pré-téléchargement en cours : tail -f $PREFETCH_LOG"
  fi
}

case "${1:-}" in
  stop)
    stop_all
    command -v termux-wake-unlock >/dev/null 2>&1 && termux-wake-unlock 2>/dev/null
    echo "🛑 Lueur, modèle IA, téléchargements et tunnels arrêtés"
    exit 0
    ;;
  restart)
    stop_all
    ;;
  status)
    print_status
    exit 0
    ;;
  boot)
    install_boot
    exit 0
    ;;
  supervise)
    supervise
    exit 0
    ;;
  "")
    ;;
  *)
    echo "Usage : $0 [restart|stop|status|boot]"
    exit 1
    ;;
esac

command -v termux-wake-lock >/dev/null 2>&1 && termux-wake-lock 2>/dev/null || true

if ! command -v python >/dev/null 2>&1; then
  echo "❌ Python n'est pas installé dans Termux."
  echo "Installe-le avec :"
  echo "  pkg install python -y"
  exit 1
fi

if [ ! -x "$SNAP_LLAMA_DIR/bin/llama-server" ]; then
  echo "❌ Build Snapdragon llama-server introuvable : $SNAP_LLAMA_DIR/bin/llama-server"
  echo "   Chemin attendu dans Termux : ~/llama-snapdragon/bin/llama-server"
  exit 1
fi

mkdir -p "$MODEL_DIR"

# --- Bibliothèques Qualcomm requises par le build Snapdragon sous Termux ---
mkdir -p "$SNAP_LLAMA_DIR/lib"

for lib in \
  libOpenCL.so \
  libcdsprpc.so \
  vendor.qti.hardware.dsp-V1-ndk.so \
  vendor.qti.hardware.dsp@1.0.so \
  libvmmem.so
do
  if [ ! -e "$SNAP_LLAMA_DIR/lib/$lib" ] && [ -r "/vendor/lib64/$lib" ]; then
    cp "/vendor/lib64/$lib" "$SNAP_LLAMA_DIR/lib/$lib" 2>/dev/null || true
  fi
done

if [ ! -r "$SNAP_LLAMA_DIR/lib/libOpenCL.so" ]; then
  echo "❌ libOpenCL.so introuvable dans $SNAP_LLAMA_DIR/lib"
  echo "   Vérifie : ls -l /vendor/lib64/libOpenCL.so"
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
# Téléchargé dans un fichier temporaire, validé, puis remplacé d'un coup :
# un réseau absent ou une copie tronquée ne casse jamais la version locale.
echo "🧭 Mise à jour du router..."
ROUTER_UPDATED=0
ROUTER_TMP="$ROUTER_SCRIPT.new"
if curl -fsSL -m 60 "$ROUTER_URL" -o "$ROUTER_TMP" \
  && python -c 'import ast,sys; ast.parse(open(sys.argv[1], encoding="utf-8").read())' "$ROUTER_TMP" 2>/dev/null; then
  if [ -f "$ROUTER_SCRIPT" ] && cmp -s "$ROUTER_TMP" "$ROUTER_SCRIPT"; then
    rm -f "$ROUTER_TMP"
    echo "✅ Router déjà à jour"
  else
    chmod +x "$ROUTER_TMP"
    mv -f "$ROUTER_TMP" "$ROUTER_SCRIPT"
    ROUTER_UPDATED=1
    echo "✅ Router mis à jour"
  fi
else
  rm -f "$ROUTER_TMP"
  if [ -f "$ROUTER_SCRIPT" ]; then
    echo "⚠️  Mise à jour du router impossible (version locale conservée)"
  else
    echo "❌ Impossible de télécharger le router et aucune copie locale"
    exit 1
  fi
fi

# --- Les modèles locaux sont démarrés à la demande par le router ---
if health_ok && router_running; then
  echo "✅ Router IA déjà actif"
  if [ "$ROUTER_UPDATED" = "1" ]; then
    # Pas de redémarrage automatique : il couperait les générations en cours.
    echo "⚠️  Nouvelle version du router téléchargée : ~/start-ai.sh restart pour l'appliquer"
  fi
else
  echo "🤖 Démarrage du router multi-modèles Android..."
  start_router || exit 1
fi

echo "✅ Router prêt"

start_prefetch

# --- Tunnel ngrok via Debian/proot ---
if ! command -v proot-distro >/dev/null 2>&1; then
  echo "❌ proot-distro n'est pas installé."
  echo
  echo "Installe-le avec :"
  echo "  pkg install proot-distro -y"
  echo "  proot-distro install debian"
  exit 1
fi

# Une seule entrée dans proot (lente) pour vérifier Debian et ngrok.
PROOT_STATE="$(proot-distro login debian -- sh -c 'test -x /root/ngrok && echo ngrok-ok || echo ngrok-missing' 2>/dev/null)"

case "$PROOT_STATE" in
  *ngrok-ok*) ;;
  *ngrok-missing*)
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
    ;;
  *)
    echo "❌ Le conteneur Debian proot n'est pas installé."
    echo
    echo "Installe-le avec :"
    echo "  proot-distro install debian"
    exit 1
    ;;
esac

if tunnel_running; then
  echo "🌐 Tunnel ngrok déjà actif"
else
  echo "🌐 Ouverture du tunnel ngrok via Debian/proot..."
  start_tunnel || exit 1
fi

start_supervisor

URL="$(tunnel_url)"

ui_ok || echo "⚠️  L'interface Lueur n'est pas servie"

echo
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🤖 Modèles disponibles :"
# La liste vient du router : plus de copie à maintenir dans ce script.
curl -fsS -m 5 "http://127.0.0.1:$PORT/models" 2>/dev/null | python -c 'import json,sys
try:
    models = json.load(sys.stdin)["models"]
except Exception:
    print("   (liste indisponible)")
    raise SystemExit
groups = {}
for m in models:
    groups.setdefault(m["provider_label"], {"ok": m["configured"], "names": []})["names"].append(m["label"])
cloud = [g for label, g in groups.items() if not label.startswith("Local")]
for label, g in groups.items():
    mark = "✅" if g["ok"] else "⚪"
    print("   %s %-24s: %s" % (mark, label, ", ".join(g["names"])))
print()
print("🔐 Fournisseurs cloud configurés : %d/%d" % (sum(g["ok"] for g in cloud), len(cloud)))'
echo "   Configuration : $ENV_FILE"
echo
echo "💾 Un seul modèle local NPU est chargé à la fois ; déchargé après ${LUEUR_IDLE_UNLOAD}s d'inactivité."
echo "☁️ Les modèles cloud n'utilisent pas la RAM du téléphone pour l'inférence."
if [ "$LUEUR_SUPERVISE" = "1" ]; then
  echo "🛡️ Superviseur actif : router et tunnel relancés automatiquement."
fi
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
echo "Téléchargements : tail -f $DOWNLOAD_LOG"
echo "Pré-téléchargement : tail -f $PREFETCH_LOG"
echo "Logs tunnel : tail -f $TUNNEL_LOG"
echo "Superviseur : tail -f $SUPERVISOR_LOG"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
