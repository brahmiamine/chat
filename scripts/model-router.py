#!/data/data/com.termux/files/usr/bin/python
"""
Android/Termux multi-model router for llama.cpp.

Why this exists:
llama.cpp's official router uses LLAMA_SUBPROCESS, which is disabled by default
on Android and currently does not build cleanly against Android/Bionic because
posix_spawn_file_actions_addchdir_np is unavailable.

This router uses Python's subprocess support instead and keeps only one
llama-server model process loaded at a time.
"""
from __future__ import annotations

import atexit
import http.client
import json
import mimetypes
import os
import signal
import subprocess
import sys
import threading
import time
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Callable

HOST = os.environ.get("LUEUR_ROUTER_HOST", "127.0.0.1")
PORT = int(os.environ.get("LUEUR_ROUTER_PORT", "8080"))
MODEL_HOST = "127.0.0.1"
MODEL_PORT = int(os.environ.get("LUEUR_MODEL_PORT", "8081"))
CTX = int(os.environ.get("LUEUR_CTX", "4096"))
# Sur téléphone, utiliser tous les cœurs (y compris les "little") ralentit la
# génération : on se limite par défaut aux cœurs performants.
THREADS = int(os.environ.get("LUEUR_THREADS", "4"))
# Les modèles "thinking" génèrent un long raisonnement caché avant la réponse.
# Désactivé par défaut pour qu'ils répondent tout de suite (LUEUR_THINKING=1 pour le garder).
THINKING = os.environ.get("LUEUR_THINKING", "0") == "1"
UI_DIR = Path(os.environ.get("LUEUR_UI_DIR", str(Path.home() / "lueur-ui"))).resolve()
LLAMA_DIR = Path(os.environ.get("LUEUR_LLAMA_DIR", str(Path.home() / "llama.cpp"))).resolve()
LLAMA_BIN = LLAMA_DIR / "build" / "bin" / "llama-server"
MODEL_LOG = Path(os.environ.get("LUEUR_MODEL_LOG", str(Path.home() / "llama-model.log")))
DEFAULT_MODEL = "lmstudio-community/Qwen3.5-4B-GGUF:Q4_K_M"

PROVIDERS: dict[str, dict[str, object]] = {
    "local": {
        "label": "Local · llama.cpp",
        "base_url": "",
        "required_env": [],
    },
    "groq": {
        "label": "GroqCloud",
        "base_url": "https://api.groq.com/openai/v1",
        "required_env": ["GROQ_API_KEY"],
    },
    "gemini": {
        "label": "Google Gemini",
        "base_url": "https://generativelanguage.googleapis.com/v1beta/openai",
        "required_env": ["GEMINI_API_KEY"],
    },
    "mistral": {
        "label": "Mistral AI",
        "base_url": "https://api.mistral.ai/v1",
        "required_env": ["MISTRAL_API_KEY"],
    },
    "openrouter": {
        "label": "OpenRouter",
        "base_url": "https://openrouter.ai/api/v1",
        "required_env": ["OPENROUTER_API_KEY"],
    },
    "cloudflare": {
        "label": "Cloudflare Workers AI",
        "base_url": "",
        "required_env": ["CLOUDFLARE_AI_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"],
    },
    "cerebras": {
        "label": "Cerebras",
        "base_url": "https://api.cerebras.ai/v1",
        "required_env": ["CEREBRAS_API_KEY"],
    },
    "huggingface": {
        "label": "Hugging Face Inference",
        "base_url": "https://router.huggingface.co/v1",
        "required_env": ["HF_TOKEN"],
    },
}

MODELS: dict[str, dict[str, object]] = {
    # Local GGUF models
    DEFAULT_MODEL: {
        "label": "Qwen3.5 4B Vision",
        "provider": "local",
        "vision": True,
        "thinking": True,
    },
    "ggml-org/gemma-3-4b-it-GGUF:Q4_K_M": {
        "label": "Gemma 3 4B Vision",
        "provider": "local",
        "vision": True,
    },
    "bartowski/microsoft_Phi-4-mini-instruct-GGUF:Q4_K_M": {
        "label": "Phi-4 Mini 3.8B",
        "provider": "local",
        "vision": False,
    },
    "bartowski/Llama-3.2-3B-Instruct-GGUF:Q4_K_M": {
        "label": "Llama 3.2 3B",
        "provider": "local",
        "vision": False,
    },
    "bartowski/HuggingFaceTB_SmolLM3-3B-GGUF:Q4_K_M": {
        "label": "SmolLM3 3B",
        "provider": "local",
        "vision": False,
        "thinking": True,
    },
    "bartowski/DeepSeek-R1-Distill-Qwen-1.5B-GGUF:Q4_K_M": {
        "label": "DeepSeek R1 1.5B",
        "provider": "local",
        "vision": False,
    },
    "bartowski/Qwen2.5-Coder-3B-Instruct-GGUF:Q4_K_M": {
        "label": "Qwen2.5 Coder 3B",
        "provider": "local",
        "vision": False,
    },

    # Cloud models. Prefixing the id avoids collisions between providers.
    "groq::openai/gpt-oss-120b": {
        "label": "GPT-OSS 120B",
        "provider": "groq",
        "remote_id": "openai/gpt-oss-120b",
        "vision": False,
    },
    "groq::qwen/qwen3.8-27b": {
        "label": "Qwen 3.8 27B",
        "provider": "groq",
        "remote_id": "qwen/qwen3.8-27b",
        "vision": True,
    },
    "gemini::gemini-3.8-flash": {
        "label": "Gemini 3.8 Flash",
        "provider": "gemini",
        "remote_id": "gemini-3.8-flash",
        "vision": True,
    },
    "mistral::mistral-small-latest": {
        "label": "Mistral Small",
        "provider": "mistral",
        "remote_id": "mistral-small-latest",
        "vision": False,
    },
    "openrouter::openrouter/free": {
        "label": "OpenRouter Free",
        "provider": "openrouter",
        "remote_id": "openrouter/free",
        "vision": True,
    },
    "cloudflare::@cf/openai/gpt-oss-120b": {
        "label": "GPT-OSS 120B",
        "provider": "cloudflare",
        "remote_id": "@cf/openai/gpt-oss-120b",
        "vision": False,
    },
    "cerebras::gpt-oss-120b": {
        "label": "GPT-OSS 120B",
        "provider": "cerebras",
        "remote_id": "gpt-oss-120b",
        "vision": False,
    },
    "huggingface::deepseek-ai/DeepSeek-R1:fastest": {
        "label": "DeepSeek R1",
        "provider": "huggingface",
        "remote_id": "deepseek-ai/DeepSeek-R1:fastest",
        "vision": False,
    },
}

ALLOWED_ORIGIN = "https://brahmiamine.github.io"
LOAD_TIMEOUT = 1800

_model_lock = threading.RLock()
_model_proc: subprocess.Popen | None = None
_model_log_handle = None
_active_model: str | None = None

# Background generation jobs are owned by the router, not by the browser
# connection. This lets llama.cpp keep generating even if the tab/browser is
# closed, suspended, or temporarily disconnected.
_jobs_lock = threading.RLock()
_generation_lock = threading.Lock()
_jobs: dict[str, "GenerationJob"] = {}
JOB_TTL = 3600


class GenerationJob:
    def __init__(self, job_id: str) -> None:
        self.id = job_id
        self.content = ""
        self.status = "running"  # running | done | stopped | error
        self.error: str | None = None
        self.cancelled = False
        self.updated_at = time.time()
        self.cond = threading.Condition()
        self.conn: http.client.HTTPConnection | None = None

    def snapshot(self) -> dict[str, object]:
        with self.cond:
            return {
                "id": self.id,
                "status": self.status,
                "content": self.content,
                "cursor": len(self.content),
                "error": self.error,
                "updated_at": self.updated_at,
            }


def prune_jobs() -> None:
    cutoff = time.time() - JOB_TTL
    with _jobs_lock:
        stale = [
            jid for jid, job in _jobs.items()
            if job.status != "running" and job.updated_at < cutoff
        ]
        for jid in stale:
            _jobs.pop(jid, None)


def get_job(job_id: str) -> GenerationJob | None:
    prune_jobs()
    with _jobs_lock:
        return _jobs.get(job_id)


def cancel_job(job_id: str) -> bool:
    job = get_job(job_id)
    if not job:
        return False
    with job.cond:
        job.cancelled = True
        if job.status == "running":
            job.status = "stopped"
        job.updated_at = time.time()
        conn = job.conn
        job.cond.notify_all()
    if conn:
        try:
            conn.close()
        except Exception:
            pass
    return True


def set_job_terminal(job: GenerationJob, status: str, error: str | None = None) -> None:
    with job.cond:
        if job.cancelled:
            job.status = "stopped"
            job.error = None
        else:
            job.status = status
            job.error = error
        job.updated_at = time.time()
        job.cond.notify_all()


def run_generation_job(job: GenerationJob, body: dict) -> None:
    # llama-server uses -np 1; serialize background generations accordingly.
    with _generation_lock:
        conn: http.client.HTTPConnection | None = None
        try:
            if job.cancelled:
                set_job_terminal(job, "stopped")
                return

            upstream = dict(body)
            upstream.pop("_lueur_job_id", None)
            upstream.pop("_lueur_cursor", None)
            upstream["stream"] = True

            model_id = str(upstream.get("model") or DEFAULT_MODEL)
            if model_id == "local":
                model_id = DEFAULT_MODEL
                upstream["model"] = model_id

            if job.cancelled:
                set_job_terminal(job, "stopped")
                return

            conn, res = open_completion(model_id, upstream)
            with job.cond:
                job.conn = conn

            if res.status >= 400:
                detail = res.read().decode("utf-8", "replace")
                raise RuntimeError(detail or f"HTTP {res.status}")

            while not job.cancelled:
                line = res.readline()
                if not line:
                    if job.cancelled:
                        break
                    raise RuntimeError("Flux modèle interrompu")
                text = line.decode("utf-8", "replace").strip()
                if not text or text.startswith(":") or not text.startswith("data:"):
                    continue

                data = text[5:].strip()
                if data == "[DONE]":
                    set_job_terminal(job, "done")
                    return

                try:
                    payload = json.loads(data)
                except Exception:
                    continue

                if payload.get("error"):
                    err = payload["error"]
                    if isinstance(err, dict):
                        raise RuntimeError(str(err.get("message") or err))
                    raise RuntimeError(str(err))

                choices = payload.get("choices") or [{}]
                delta = (choices[0].get("delta") or {}) if choices else {}
                token = delta.get("content")
                if token:
                    with job.cond:
                        job.content += str(token)
                        job.updated_at = time.time()
                        job.cond.notify_all()
                elif delta.get("reasoning_content"):
                    # Wake attached clients so they still receive keepalives.
                    with job.cond:
                        job.updated_at = time.time()
                        job.cond.notify_all()

            set_job_terminal(job, "stopped")
        except Exception as exc:
            if job.cancelled:
                set_job_terminal(job, "stopped")
            else:
                log(f"Generation {job.id} error: {exc}")
                set_job_terminal(job, "error", str(exc))
        finally:
            if conn:
                try:
                    conn.close()
                except Exception:
                    pass
            with job.cond:
                job.conn = None


def get_or_start_job(job_id: str, body: dict) -> GenerationJob:
    prune_jobs()
    with _jobs_lock:
        existing = _jobs.get(job_id)
        if existing:
            return existing
        job = GenerationJob(job_id)
        _jobs[job_id] = job

    threading.Thread(
        target=run_generation_job,
        args=(job, body),
        name=f"lueur-job-{job_id[:8]}",
        daemon=True,
    ).start()
    return job


def log(message: str) -> None:
    print(time.strftime("[%H:%M:%S]"), message, flush=True)


def provider_name(model_id: str) -> str:
    meta = MODELS.get(model_id) or {}
    return str(meta.get("provider") or "local")


def provider_statuses() -> dict[str, dict[str, object]]:
    out: dict[str, dict[str, object]] = {}
    for pid, meta in PROVIDERS.items():
        required = [str(x) for x in meta.get("required_env", [])]
        missing = [name for name in required if not os.environ.get(name)]
        out[pid] = {
            "id": pid,
            "label": meta["label"],
            "configured": not missing,
            "missing": missing,
        }
    return out


def provider_base_url(provider: str) -> str:
    if provider == "cloudflare":
        account_id = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "").strip()
        if not account_id:
            raise RuntimeError(
                "Cloudflare Workers AI non configuré: ajoute CLOUDFLARE_ACCOUNT_ID dans ~/.lueur.env"
            )
        return f"https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1"
    return str(PROVIDERS[provider].get("base_url") or "")


def provider_headers(provider: str) -> dict[str, str]:
    statuses = provider_statuses()
    state = statuses.get(provider)
    if not state:
        raise RuntimeError(f"Fournisseur inconnu: {provider}")
    if not state["configured"]:
        missing = ", ".join(state["missing"])
        raise RuntimeError(
            f"{state['label']} non configuré. Ajoute {missing} dans ~/.lueur.env puis relance start-ai.sh"
        )

    if provider == "local":
        return {"Content-Type": "application/json", "Accept": "text/event-stream"}

    key_env = {
        "groq": "GROQ_API_KEY",
        "gemini": "GEMINI_API_KEY",
        "mistral": "MISTRAL_API_KEY",
        "openrouter": "OPENROUTER_API_KEY",
        "cloudflare": "CLOUDFLARE_AI_API_TOKEN",
        "cerebras": "CEREBRAS_API_KEY",
        "huggingface": "HF_TOKEN",
    }[provider]
    headers = {
        "Authorization": f"Bearer {os.environ.get(key_env, '')}",
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
    }
    if provider == "openrouter":
        headers["HTTP-Referer"] = "https://github.com/brahmiamine/chat"
        headers["X-Title"] = "Lueur"
    return headers


def open_completion(
    model_id: str,
    body: dict,
    keepalive: Callable[[], None] | None = None,
) -> tuple[http.client.HTTPConnection, http.client.HTTPResponse]:
    if model_id == "local":
        model_id = DEFAULT_MODEL
    if model_id not in MODELS:
        raise ValueError(f"Modèle inconnu: {model_id}")

    meta = MODELS[model_id]
    provider = str(meta.get("provider") or "local")
    upstream = dict(body)
    upstream.pop("_lueur_job_id", None)
    upstream.pop("_lueur_cursor", None)
    upstream["stream"] = bool(body.get("stream", False))

    if provider == "local":
        upstream["model"] = model_id
        ensure_model(model_id, keepalive)
        conn: http.client.HTTPConnection = http.client.HTTPConnection(
            MODEL_HOST, MODEL_PORT, timeout=3600
        )
        path = "/v1/chat/completions"
        headers = provider_headers("local")
    else:
        # Cloud inference does not need a GGUF model occupying phone RAM.
        stop_model()
        upstream["model"] = str(meta.get("remote_id") or model_id)
        base = provider_base_url(provider)
        headers = provider_headers(provider)
        parsed = urllib.parse.urlsplit(base)
        if parsed.scheme != "https" or not parsed.hostname:
            raise RuntimeError(f"URL fournisseur invalide: {base}")
        conn = http.client.HTTPSConnection(parsed.hostname, parsed.port or 443, timeout=3600)
        path = parsed.path.rstrip("/") + "/chat/completions"

    raw = json.dumps(upstream, ensure_ascii=False).encode("utf-8")
    conn.request("POST", path, body=raw, headers=headers)
    return conn, conn.getresponse()


def model_health() -> bool:
    try:
        with urllib.request.urlopen(f"http://{MODEL_HOST}:{MODEL_PORT}/health", timeout=2) as res:
            if res.status != 200:
                return False
            body = res.read(256)
            return b'"ok"' in body or b'"status"' in body
    except Exception:
        return False


def stop_model() -> None:
    global _model_proc, _model_log_handle, _active_model
    proc = _model_proc
    _model_proc = None
    _active_model = None

    if proc and proc.poll() is None:
        log("Arrêt du modèle actif...")
        try:
            proc.terminate()
            proc.wait(timeout=15)
        except Exception:
            try:
                proc.kill()
                proc.wait(timeout=5)
            except Exception:
                pass

    if _model_log_handle:
        try:
            _model_log_handle.close()
        except Exception:
            pass
        _model_log_handle = None


def ensure_model(model_id: str, keepalive: Callable[[], None] | None = None) -> None:
    global _model_proc, _model_log_handle, _active_model

    if model_id == "local":
        model_id = DEFAULT_MODEL
    if model_id not in MODELS:
        raise ValueError(f"Modèle inconnu: {model_id}")

    meta = MODELS[model_id]
    if str(meta.get("provider") or "local") != "local":
        # Selecting a cloud model releases local llama.cpp RAM.
        with _model_lock:
            stop_model()
        return

    with _model_lock:
        if _active_model == model_id and _model_proc and _model_proc.poll() is None and model_health():
            return

        stop_model()

        if not LLAMA_BIN.exists():
            raise RuntimeError(f"llama-server introuvable: {LLAMA_BIN}")

        args = [
            str(LLAMA_BIN),
            "-hf", model_id,
            "--host", MODEL_HOST,
            "--port", str(MODEL_PORT),
            "-c", str(CTX),
            "-np", "1",
        ]
        if THREADS > 0:
            args += ["-t", str(THREADS)]
        if bool(meta.get("vision")):
            args.append("--mmproj-auto")

        MODEL_LOG.parent.mkdir(parents=True, exist_ok=True)
        _model_log_handle = MODEL_LOG.open("w", encoding="utf-8")
        log(f"Chargement: {meta['label']} ({model_id})")
        _model_proc = subprocess.Popen(
            args,
            cwd=str(LLAMA_DIR),
            stdout=_model_log_handle,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
        _active_model = model_id

        started = time.monotonic()
        last_keepalive = 0.0
        while time.monotonic() - started < LOAD_TIMEOUT:
            if _model_proc.poll() is not None:
                code = _model_proc.returncode
                _active_model = None
                raise RuntimeError(
                    f"llama-server s'est arrêté pendant le chargement (code {code}). "
                    f"Voir {MODEL_LOG}"
                )

            if model_health():
                log(f"Modèle prêt: {meta['label']}")
                return

            now = time.monotonic()
            if keepalive and now - last_keepalive >= 2:
                keepalive()
                last_keepalive = now

            time.sleep(1)

        stop_model()
        raise TimeoutError(f"Chargement du modèle > {LOAD_TIMEOUT}s")


def active_model() -> str | None:
    with _model_lock:
        if _model_proc and _model_proc.poll() is None:
            return _active_model
        return None


class RouterHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "LueurRouter/1.0"

    def log_message(self, fmt: str, *args) -> None:
        log(f"{self.client_address[0]} {fmt % args}")

    def _cors(self) -> None:
        origin = self.headers.get("Origin", "")
        if origin == ALLOWED_ORIGIN:
            self.send_header("Access-Control-Allow-Origin", ALLOWED_ORIGIN)
            self.send_header("Vary", "Origin")

    def _json(self, status: int, data: object) -> None:
        raw = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self._cors()
        self.end_headers()
        self.wfile.write(raw)

    def _read_json(self) -> dict:
        n = int(self.headers.get("Content-Length", "0") or 0)
        raw = self.rfile.read(n) if n else b"{}"
        return json.loads(raw.decode("utf-8"))

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self._cors()
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Access-Control-Max-Age", "86400")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self) -> None:
        path = urllib.parse.urlsplit(self.path).path

        if path == "/health":
            self._json(200, {
                "status": "ok",
                "router": "termux-python",
                "active_model": active_model(),
                "background_generations": True,
                "providers": provider_statuses(),
            })
            return

        if path == "/models":
            self._json(200, {
                "models": [
                    {
                        "id": mid,
                        "label": meta["label"],
                        "vision": meta["vision"],
                        "provider": meta.get("provider", "local"),
                        "provider_label": PROVIDERS[str(meta.get("provider") or "local")]["label"],
                        "configured": provider_statuses()[str(meta.get("provider") or "local")]["configured"],
                    }
                    for mid, meta in MODELS.items()
                ],
                "active_model": active_model(),
            })
            return

        if path == "/v1/models":
            self._json(200, {
                "object": "list",
                "data": [
                    {
                        "id": mid,
                        "object": "model",
                        "owned_by": provider_name(mid),
                    }
                    for mid in MODELS
                ],
            })
            return

        if path == "/props":
            self._json(200, {
                "model_path": active_model() or "",
                "n_ctx": CTX,
                "default_generation_settings": {"n_ctx": CTX},
                "router": "termux-python",
                "providers": provider_statuses(),
            })
            return

        if path == "/providers":
            self._json(200, {"providers": provider_statuses()})
            return

        if path.startswith("/lueur/generations/"):
            suffix = path[len("/lueur/generations/"):].strip("/")
            if suffix.endswith("/stream"):
                job_id = urllib.parse.unquote(suffix[:-len("/stream")].strip("/"))
                job = get_job(job_id)
                if not job:
                    self._json(404, {"error": {"message": "Generation not found"}})
                    return
                query = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
                try:
                    cursor = max(0, int((query.get("cursor") or ["0"])[0]))
                except ValueError:
                    cursor = 0
                self._stream_job(job, cursor)
                return

            job_id = urllib.parse.unquote(suffix)
            job = get_job(job_id)
            if not job:
                self._json(404, {"error": {"message": "Generation not found"}})
                return
            self._json(200, job.snapshot())
            return

        self._serve_static(path)

    def do_POST(self) -> None:
        path = urllib.parse.urlsplit(self.path).path

        if path == "/models/load":
            try:
                body = self._read_json()
                model_id = str(body.get("model") or DEFAULT_MODEL)
                ensure_model(model_id)
                self._json(200, {"status": "ok", "model": active_model()})
            except ValueError as e:
                self._json(400, {"error": {"message": str(e)}})
            except Exception as e:
                self._json(500, {"error": {"message": str(e)}})
            return

        if path == "/models/unload":
            stop_model()
            self._json(200, {"status": "ok"})
            return

        if path.startswith("/lueur/generations/") and path.endswith("/cancel"):
            suffix = path[len("/lueur/generations/"):-len("/cancel")].strip("/")
            job_id = urllib.parse.unquote(suffix)
            if not job_id or not cancel_job(job_id):
                self._json(404, {"error": {"message": "Generation not found"}})
            else:
                self._json(200, {"status": "stopped", "id": job_id})
            return

        if path == "/v1/chat/completions":
            self._chat_completions()
            return

        self._json(404, {"error": {"message": "Not found"}})

    def _chat_completions(self) -> None:
        try:
            body = self._read_json()
        except Exception as e:
            self._json(400, {"error": {"message": f"JSON invalide: {e}"}})
            return

        model_id = str(body.get("model") or DEFAULT_MODEL)
        if model_id == "local":
            model_id = DEFAULT_MODEL
            body["model"] = model_id
        stream = bool(body.get("stream", False))
        job_id = str(body.get("_lueur_job_id") or "").strip()
        try:
            job_cursor = max(0, int(body.get("_lueur_cursor") or 0))
        except (TypeError, ValueError):
            job_cursor = 0

        if model_id not in MODELS:
            self._json(400, {"error": {"message": f"Modèle inconnu: {model_id}"}})
            return

        if (
            provider_name(model_id) == "local"
            and not THINKING
            and MODELS[model_id].get("thinking")
            and "chat_template_kwargs" not in body
        ):
            body["chat_template_kwargs"] = {"enable_thinking": False}

        if stream:
            # Lueur background mode: generation belongs to the router. If the
            # browser disconnects, only this SSE attachment ends; llama.cpp
            # continues and the UI can reconnect later with the same job id.
            if job_id:
                job = get_or_start_job(job_id, body)
                self._stream_job(job, job_cursor)
                return

            # Compatibility mode for other OpenAI-compatible clients.
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "close")
            self._cors()
            self.end_headers()

            def keepalive() -> None:
                try:
                    self.wfile.write(b": model-loading\n\n")
                    self.wfile.flush()
                except Exception:
                    pass

            try:
                keepalive()
                self._proxy_stream(body, keepalive)
            except BrokenPipeError:
                return
            except Exception as e:
                payload = json.dumps({"error": {"message": str(e)}}, ensure_ascii=False)
                try:
                    self.wfile.write(f"data: {payload}\n\ndata: [DONE]\n\n".encode("utf-8"))
                    self.wfile.flush()
                except Exception:
                    pass
            self.close_connection = True
            return

        try:
            self._proxy_json(body)
        except ValueError as e:
            self._json(400, {"error": {"message": str(e)}})
        except Exception as e:
            self._json(500, {"error": {"message": str(e)}})

    def _stream_job(self, job: GenerationJob, cursor: int = 0) -> None:
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache, no-transform")
        self.send_header("X-Accel-Buffering", "no")
        self.send_header("Connection", "close")
        self._cors()
        self.end_headers()

        try:
            while True:
                with job.cond:
                    content = job.content
                    status = job.status
                    error = job.error

                    if len(content) <= cursor and status == "running":
                        job.cond.wait(timeout=10)
                        content = job.content
                        status = job.status
                        error = job.error

                if len(content) > cursor:
                    delta = content[cursor:]
                    cursor = len(content)
                    payload = {
                        "choices": [{"delta": {"content": delta}}],
                        "lueur": {"job_id": job.id, "cursor": cursor, "status": status},
                    }
                    raw = json.dumps(payload, ensure_ascii=False)
                    self.wfile.write(f"data: {raw}\n\n".encode("utf-8"))
                    self.wfile.flush()
                    continue

                if status == "running":
                    self.wfile.write(b": keepalive\n\n")
                    self.wfile.flush()
                    continue

                if status == "error":
                    payload = json.dumps(
                        {"error": {"message": error or "Generation failed"}},
                        ensure_ascii=False,
                    )
                    self.wfile.write(f"data: {payload}\n\n".encode("utf-8"))

                self.wfile.write(b"data: [DONE]\n\n")
                self.wfile.flush()
                break
        except (BrokenPipeError, ConnectionResetError):
            # Important: do NOT cancel the job. Browser disconnects are normal.
            pass
        finally:
            self.close_connection = True

    def _proxy_stream(
        self,
        body: dict,
        keepalive: Callable[[], None] | None = None,
    ) -> None:
        model_id = str(body.get("model") or DEFAULT_MODEL)
        conn: http.client.HTTPConnection | None = None
        try:
            conn, res = open_completion(model_id, body, keepalive)
            if res.status >= 400:
                detail = res.read().decode("utf-8", "replace")
                payload = json.dumps(
                    {"error": {"message": detail or f"HTTP {res.status}"}},
                    ensure_ascii=False,
                )
                self.wfile.write(f"data: {payload}\n\ndata: [DONE]\n\n".encode("utf-8"))
                self.wfile.flush()
                return

            while True:
                chunk = res.read1(4096)
                if not chunk:
                    break
                self.wfile.write(chunk)
                self.wfile.flush()
        finally:
            if conn:
                conn.close()

    def _proxy_json(self, body: dict) -> None:
        model_id = str(body.get("model") or DEFAULT_MODEL)
        conn: http.client.HTTPConnection | None = None
        try:
            conn, res = open_completion(model_id, body)
            payload = res.read()
            self.send_response(res.status)
            self.send_header("Content-Type", res.getheader("Content-Type", "application/json"))
            self.send_header("Content-Length", str(len(payload)))
            self._cors()
            self.end_headers()
            self.wfile.write(payload)
        finally:
            if conn:
                conn.close()

    def _serve_static(self, url_path: str) -> None:
        if not UI_DIR.exists():
            self._json(503, {"error": {"message": f"Interface introuvable: {UI_DIR}"}})
            return

        decoded = urllib.parse.unquote(url_path)
        rel = decoded.lstrip("/") or "index.html"
        candidate = (UI_DIR / rel).resolve()

        try:
            candidate.relative_to(UI_DIR)
        except ValueError:
            self._json(403, {"error": {"message": "Forbidden"}})
            return

        if candidate.is_dir():
            candidate = candidate / "index.html"

        if not candidate.exists() or not candidate.is_file():
            # SPA fallback for client-side routes.
            if "." not in Path(rel).name:
                candidate = UI_DIR / "index.html"
            else:
                self._json(404, {"error": {"message": "Not found"}})
                return

        try:
            data = candidate.read_bytes()
        except Exception as e:
            self._json(500, {"error": {"message": str(e)}})
            return

        ctype = mimetypes.guess_type(str(candidate))[0] or "application/octet-stream"
        if candidate.suffix in {".js", ".mjs"}:
            ctype = "text/javascript"
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache" if candidate.name in {"index.html", "sw.js"} else "public, max-age=31536000, immutable")
        self.end_headers()
        self.wfile.write(data)


def cleanup() -> None:
    with _jobs_lock:
        job_ids = list(_jobs)
    for job_id in job_ids:
        cancel_job(job_id)
    stop_model()


def main() -> int:
    if not LLAMA_BIN.exists():
        print(f"❌ llama-server introuvable: {LLAMA_BIN}", file=sys.stderr)
        return 1

    atexit.register(cleanup)

    def handle_signal(signum, _frame):
        log(f"Signal {signum}, arrêt...")
        cleanup()
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, handle_signal)
    signal.signal(signal.SIGINT, handle_signal)

    server = ThreadingHTTPServer((HOST, PORT), RouterHandler)
    server.daemon_threads = True

    log(f"Lueur router: http://{HOST}:{PORT}")
    log(f"llama-server interne: http://{MODEL_HOST}:{MODEL_PORT}")
    configured = sum(1 for p in provider_statuses().values() if p["configured"])
    log(f"Modèles: {len(MODELS)} · fournisseurs configurés: {configured}/{len(PROVIDERS)}")
    log("Le local garde un seul modèle GGUF en RAM; les modèles cloud passent par le router.")
    try:
        server.serve_forever(poll_interval=0.5)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        cleanup()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
