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
import fcntl
import http.client
import json
import mimetypes
import os
import shutil
import signal
import subprocess
import sys
import threading
import time
import urllib.parse
import urllib.request
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Callable, Iterator

HOST = os.environ.get("LUEUR_ROUTER_HOST", "127.0.0.1")
PORT = int(os.environ.get("LUEUR_ROUTER_PORT", "8080"))
MODEL_HOST = "127.0.0.1"
MODEL_PORT = int(os.environ.get("LUEUR_MODEL_PORT", "8081"))
CTX = int(os.environ.get("LUEUR_CTX", "4096"))
# Sur téléphone, utiliser tous les cœurs (y compris les "little") ralentit la
# génération : on se limite par défaut aux cœurs performants.
THREADS = int(os.environ.get("LUEUR_THREADS", "6"))
# Les modèles "thinking" génèrent un long raisonnement caché avant la réponse.
# Désactivé par défaut pour qu'ils répondent tout de suite (LUEUR_THINKING=1 pour le garder).
THINKING = os.environ.get("LUEUR_THINKING", "0") == "1"
UI_DIR = Path(os.environ.get("LUEUR_UI_DIR", str(Path.home() / "lueur-ui"))).resolve()
LLAMA_DIR = Path(os.environ.get("LUEUR_LLAMA_DIR", str(Path.home() / "llama.cpp"))).resolve()
SNAP_LLAMA_DIR = Path(
    os.environ.get("LUEUR_SNAP_LLAMA_DIR", str(Path.home() / "llama-snapdragon"))
).resolve()
SNAP_LLAMA_BIN = SNAP_LLAMA_DIR / "bin" / "llama-server"
MODEL_DIR = Path(
    os.environ.get("LUEUR_MODEL_DIR", str(Path.home() / "models"))
).resolve()
MODEL_LOG = Path(os.environ.get("LUEUR_MODEL_LOG", str(Path.home() / "llama-model.log")))
DOWNLOAD_LOG = Path(
    os.environ.get("LUEUR_DOWNLOAD_LOG", str(Path.home() / "lueur-model-download.log"))
)
DEFAULT_MODEL = os.environ.get("LUEUR_DEFAULT_MODEL", "local::qwen2.5-7b-instruct-q4_0")

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
    "huggingface": {
        "label": "Hugging Face Inference",
        "base_url": "https://router.huggingface.co/v1",
        "required_env": ["HF_TOKEN"],
    },
    "nvidia": {
        "label": "NVIDIA NIM",
        "base_url": "https://integrate.api.nvidia.com/v1",
        "required_env": ["NVIDIA_API_KEY"],
    },
    "cohere": {
        "label": "Cohere",
        "base_url": "https://api.cohere.ai/compatibility/v1",
        "required_env": ["COHERE_API_KEY"],
    },
    "vercel": {
        "label": "Vercel AI Gateway",
        "base_url": "https://ai-gateway.vercel.sh/v1",
        "required_env": ["AI_GATEWAY_API_KEY"],
    },
}

MODELS: dict[str, dict[str, object]] = {
    # Snapdragon Hexagon HTP0 models. Exactly one local GGUF is loaded at a time.
    "local::phi4-mini-3.8b-q4_0": {
        "label": "Phi-4 Mini 3.8B · Snapdragon NPU",
        "provider": "local",
        "vision": False,
        "filename": "microsoft_Phi-4-mini-instruct-Q4_0.gguf",
        "url": "https://huggingface.co/bartowski/microsoft_Phi-4-mini-instruct-GGUF/resolve/main/microsoft_Phi-4-mini-instruct-Q4_0.gguf",
        "ubatch": 1024,
    },
    "local::qwen2.5-7b-instruct-q4_0": {
        "label": "Qwen2.5 7B · Snapdragon NPU",
        "provider": "local",
        "vision": False,
        "filename": "Qwen2.5-7B-Instruct-Q4_0.gguf",
        "url": "https://huggingface.co/bartowski/Qwen2.5-7B-Instruct-GGUF/resolve/main/Qwen2.5-7B-Instruct-Q4_0.gguf",
        "ubatch": 1024,
    },
    "local::qwen3-8b-q4_0": {
        "label": "Qwen3 8B · Snapdragon NPU",
        "provider": "local",
        "vision": False,
        "thinking": True,
        "filename": "Qwen3-8B-Q4_0.gguf",
        "url": "https://huggingface.co/bartowski/Qwen_Qwen3-8B-GGUF/resolve/main/Qwen_Qwen3-8B-Q4_0.gguf",
        "ubatch": 1024,
    },
    "local::qwen2.5-coder-7b-q4_0": {
        "label": "Qwen2.5 Coder 7B · Snapdragon NPU",
        "provider": "local",
        "vision": False,
        "filename": "Qwen2.5-Coder-7B-Instruct-Q4_0.gguf",
        "url": "https://huggingface.co/bartowski/Qwen2.5-Coder-7B-Instruct-GGUF/resolve/main/Qwen2.5-Coder-7B-Instruct-Q4_0.gguf",
        "ubatch": 1024,
    },
    "local::qwen3.5-9b-q4_0": {
        "label": "Qwen3.5 9B · Snapdragon NPU",
        "provider": "local",
        "vision": False,
        "filename": "Qwen_Qwen3.5-9B-Q4_0.gguf",
        "url": "https://huggingface.co/bartowski/Qwen_Qwen3.5-9B-GGUF/resolve/main/Qwen_Qwen3.5-9B-Q4_0.gguf",
        "ubatch": 512,
    },
    "local::deepseek-r1-qwen-7b-q4_0": {
        "label": "DeepSeek R1 Qwen 7B · Snapdragon NPU",
        "provider": "local",
        "vision": False,
        "thinking": True,
        "filename": "DeepSeek-R1-Distill-Qwen-7B-Q4_0.gguf",
        "url": "https://huggingface.co/bartowski/DeepSeek-R1-Distill-Qwen-7B-GGUF/resolve/main/DeepSeek-R1-Distill-Qwen-7B-Q4_0.gguf",
        "ubatch": 1024,
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
    "huggingface::deepseek-ai/DeepSeek-R1:fastest": {
        "label": "DeepSeek R1",
        "provider": "huggingface",
        "remote_id": "deepseek-ai/DeepSeek-R1:fastest",
        "vision": False,
    },
    # Current NVIDIA hosted free endpoints. Retired ids are mapped below so
    # stale browser settings continue to work until the UI refreshes.
    "nvidia::deepseek-ai/deepseek-v4.1-flash": {
        "label": "DeepSeek V4.1 Flash Vision",
        "provider": "nvidia",
        "remote_id": "deepseek-ai/deepseek-v4.1-flash",
        "vision": True,
    },
    "nvidia::z-ai/glm-5.3": {
        "label": "GLM-5.3",
        "provider": "nvidia",
        "remote_id": "z-ai/glm-5.3",
        "vision": False,
    },
    "nvidia::z-ai/glm-5.3-flash": {
        "label": "GLM-5.3 Flash Vision",
        "provider": "nvidia",
        "remote_id": "z-ai/glm-5.3-flash",
        "vision": True,
    },
    "nvidia::nvidia/nemotron-3.5-lightning-30b-a3b": {
        "label": "Nemotron 3.5 Lightning 30B",
        "provider": "nvidia",
        "remote_id": "nvidia/nemotron-3.5-lightning-30b-a3b",
        "vision": False,
    },
    "nvidia::nvidia/nemotron-3-super-120b-a12b": {
        "label": "Nemotron 3 Super 120B",
        "provider": "nvidia",
        "remote_id": "nvidia/nemotron-3-super-120b-a12b",
        "vision": False,
    },
    "nvidia::openai/gpt-oss-20b": {
        "label": "GPT-OSS 20B",
        "provider": "nvidia",
        "remote_id": "openai/gpt-oss-20b",
        "vision": False,
    },
    "nvidia::google/gemma-4-31b-it": {
        "label": "Gemma 4 31B Vision",
        "provider": "nvidia",
        "remote_id": "google/gemma-4-31b-it",
        "vision": True,
    },
    "nvidia::meta/muse-glimmer-30b": {
        "label": "Muse Glimmer 30B Vision",
        "provider": "nvidia",
        "remote_id": "meta/muse-glimmer-30b",
        "vision": True,
    },
    "cohere::command-a-plus-05-2026": {
        "label": "Command A+",
        "provider": "cohere",
        "remote_id": "command-a-plus-05-2026",
        "vision": False,
    },
    "vercel::inclusionai/ling-3.0-flash-vl": {
        "label": "Ling 3.0 Flash VL Free",
        "provider": "vercel",
        "remote_id": "inclusionai/ling-3.0-flash-vl",
        "vision": True,
    },
}

MODEL_ALIASES = {
    "local::gemma3-12b-q4_0": "local::qwen3.5-9b-q4_0",
    "local::deepseek-r1-qwen-14b-q4_0": "local::deepseek-r1-qwen-7b-q4_0",
    "nvidia::openai/gpt-oss-120b": "nvidia::openai/gpt-oss-20b",
    "nvidia::deepseek-ai/deepseek-v4-flash": "nvidia::deepseek-ai/deepseek-v4.1-flash",
    "nvidia::qwen/qwen3-next-80b-a3b-instruct": "nvidia::z-ai/glm-5.3",
}

ALLOWED_ORIGIN = "https://brahmiamine.github.io"
LOAD_TIMEOUT = 1800
# Décharge le modèle local NPU après N secondes sans requête (0 = jamais).
IDLE_UNLOAD = int(os.environ.get("LUEUR_IDLE_UNLOAD", "600"))
# 1 = libérer la RAM du modèle local dès qu'un modèle cloud est utilisé.
# Par défaut le modèle local reste chargé (pas de rechargement lent en
# alternant cloud/local) et c'est le délai d'inactivité qui le décharge.
CLOUD_UNLOADS_LOCAL = os.environ.get("LUEUR_CLOUD_UNLOAD", "0") == "1"
# Marge d'espace disque gardée libre après un téléchargement de modèle.
DISK_MARGIN = 512 * 1024 * 1024

# _model_lock protège le cycle de vie du processus llama-server (chargement,
# arrêt). Il n'est jamais nécessaire pour *lire* l'état : /health et /models
# restent donc réactifs pendant un chargement ou un téléchargement.
_model_lock = threading.RLock()
_model_proc: subprocess.Popen | None = None
_model_log_handle = None
_active_model: str | None = None
_loading_model: str | None = None

# Nombre de requêtes en cours sur le modèle local et date de dernière
# utilisation, pour ne jamais décharger un modèle en pleine génération.
_usage_lock = threading.Lock()
_model_users = 0
_model_last_used = time.monotonic()

# Background generation jobs are owned by the router, not by the browser
# connection. This lets llama.cpp keep generating even if the tab/browser is
# closed, suspended, or temporarily disconnected.
_jobs_lock = threading.RLock()
_generation_lock = threading.Lock()
_jobs: dict[str, "GenerationJob"] = {}
JOB_TTL = 3600


def upstream_error_message(raw: str, status: int) -> str:
    text = (raw or "").strip()
    if not text:
        return f"HTTP {status}"
    try:
        data = json.loads(text)
        if isinstance(data, dict):
            err = data.get("error")
            if isinstance(err, dict) and err.get("message"):
                return str(err["message"])
            if data.get("message"):
                return str(data["message"])
            if data.get("detail"):
                return str(data["detail"])
            if data.get("title"):
                return str(data["title"])
    except Exception:
        pass
    return text


def _number(value: object) -> float | None:
    try:
        if value is None or isinstance(value, bool):
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _integer(value: object) -> int | None:
    n = _number(value)
    return max(0, int(n)) if n is not None else None


def estimate_text_tokens(text: str) -> int:
    # Provider tokenizers differ. This fallback is intentionally marked
    # "estimated" in the UI; exact/provider counts replace it whenever present.
    chars = len(text or "")
    return 0 if chars == 0 else max(1, round(chars / 4))


def estimate_message_tokens(messages: object) -> int:
    if not isinstance(messages, list):
        return 0
    total = 0
    for message in messages:
        if not isinstance(message, dict):
            continue
        # Small per-message overhead approximates role/template tokens.
        total += 4
        content = message.get("content")
        if isinstance(content, str):
            total += estimate_text_tokens(content)
        elif isinstance(content, list):
            for part in content:
                if not isinstance(part, dict):
                    continue
                if part.get("type") == "text":
                    total += estimate_text_tokens(str(part.get("text") or ""))
                elif part.get("type") == "image_url":
                    # Images are tokenized differently by every vision model.
                    # Keep a conservative placeholder and flag the whole count
                    # as estimated rather than counting a huge base64 data URL.
                    total += 256
    return total


class GenerationJob:
    def __init__(self, job_id: str, body: dict) -> None:
        self.id = job_id
        self.content = ""
        self.status = "running"  # running | done | stopped | error
        self.error: str | None = None
        self.error_code: int | None = None
        self.cancelled = False
        self.updated_at = time.time()
        self.cond = threading.Condition()
        self.conn: http.client.HTTPConnection | None = None

        requested_model = str(body.get("model") or DEFAULT_MODEL)
        if requested_model == "local":
            requested_model = DEFAULT_MODEL
        meta = MODELS.get(requested_model) or {}
        self.model_id = requested_model
        self.provider = str(meta.get("provider") or "local")
        self.provider_label = str(
            (PROVIDERS.get(self.provider) or {}).get("label") or self.provider
        )
        self.resolved_model = str(meta.get("remote_id") or requested_model)
        self.started_at = time.time()
        self.upstream_started_at: float | None = None
        self.first_token_at: float | None = None
        self.completed_at: float | None = None
        self.estimated_input_tokens = estimate_message_tokens(body.get("messages"))
        self.input_tokens: int | None = None
        self.output_tokens: int | None = None
        self.total_tokens: int | None = None
        self.token_count_source: str | None = None  # provider | local
        self.finish_reason: str | None = None
        self.cost_usd: float | None = 0.0 if self.provider == "local" else None
        self.http_status: int | None = None
        self.attachments = 0

    def update_usage(self, payload: dict) -> None:
        with self.cond:
            resolved = payload.get("model")
            if resolved:
                self.resolved_model = str(resolved)

            choices = payload.get("choices")
            if isinstance(choices, list) and choices:
                choice = choices[0] if isinstance(choices[0], dict) else {}
                finish = choice.get("finish_reason")
                if finish:
                    self.finish_reason = str(finish)

            usage = payload.get("usage")
            if isinstance(usage, dict):
                prompt = _integer(
                    usage.get("prompt_tokens")
                    if usage.get("prompt_tokens") is not None
                    else usage.get("input_tokens")
                )
                completion = _integer(
                    usage.get("completion_tokens")
                    if usage.get("completion_tokens") is not None
                    else usage.get("output_tokens")
                )
                total = _integer(usage.get("total_tokens"))
                if prompt is not None:
                    self.input_tokens = prompt
                if completion is not None:
                    self.output_tokens = completion
                if total is not None:
                    self.total_tokens = total
                if prompt is not None or completion is not None or total is not None:
                    self.token_count_source = "provider"

                for key in ("cost", "total_cost", "cost_usd"):
                    value = _number(usage.get(key))
                    if value is not None:
                        self.cost_usd = value
                        break

            # llama.cpp can expose exact prompt/predicted counts as timings.
            timings = payload.get("timings")
            if isinstance(timings, dict) and self.token_count_source != "provider":
                prompt_n = _integer(timings.get("prompt_n"))
                predicted_n = _integer(timings.get("predicted_n"))
                if prompt_n is not None:
                    self.input_tokens = prompt_n
                if predicted_n is not None:
                    self.output_tokens = predicted_n
                if prompt_n is not None or predicted_n is not None:
                    self.total_tokens = (prompt_n or 0) + (predicted_n or 0)
                    self.token_count_source = "local"

            # A few gateways report cost at the top level rather than in usage.
            if self.cost_usd is None:
                for key in ("cost", "total_cost", "cost_usd"):
                    value = _number(payload.get(key))
                    if value is not None:
                        self.cost_usd = value
                        break

    def metrics_snapshot(self) -> dict[str, object]:
        with self.cond:
            end = self.completed_at or time.time()
            output = self.output_tokens
            source = self.token_count_source
            if output is None:
                output = estimate_text_tokens(self.content)
            input_tokens = self.input_tokens
            if input_tokens is None:
                input_tokens = self.estimated_input_tokens
            total = self.total_tokens
            if total is None:
                total = input_tokens + output
            if not source:
                source = "estimated"

            ttft_ms = (
                round((self.first_token_at - self.started_at) * 1000)
                if self.first_token_at is not None else None
            )
            duration_ms = max(0, round((end - self.started_at) * 1000))
            generation_ms = (
                max(0, round((end - self.first_token_at) * 1000))
                if self.first_token_at is not None else None
            )
            tps = None
            if generation_ms and generation_ms > 0 and output > 0:
                tps = round(output / (generation_ms / 1000), 2)

            queue_ms = None
            if self.upstream_started_at is not None:
                queue_ms = max(0, round((self.upstream_started_at - self.started_at) * 1000))

            return {
                "provider": self.provider,
                "provider_label": self.provider_label,
                "model_id": self.model_id,
                "resolved_model": self.resolved_model,
                "input_tokens": input_tokens,
                "output_tokens": output,
                "total_tokens": total,
                "token_count_source": source,
                "ttft_ms": ttft_ms,
                "duration_ms": duration_ms,
                "generation_ms": generation_ms,
                "tokens_per_second": tps,
                "queue_ms": queue_ms,
                "context_limit": CTX if self.provider == "local" else None,
                "finish_reason": self.finish_reason,
                "cost_usd": self.cost_usd,
                "reconnects": max(0, self.attachments - 1),
                "http_status": self.http_status,
                "started_at": round(self.started_at * 1000),
                "completed_at": round(self.completed_at * 1000) if self.completed_at else None,
            }

    def snapshot(self) -> dict[str, object]:
        with self.cond:
            return {
                "id": self.id,
                "status": self.status,
                "content": self.content,
                "cursor": len(self.content),
                "error": self.error,
                "error_code": self.error_code,
                "updated_at": self.updated_at,
                "metrics": self.metrics_snapshot(),
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
        if job.completed_at is None:
            job.completed_at = job.updated_at
        conn = job.conn
        job.cond.notify_all()
    if conn:
        try:
            conn.close()
        except Exception:
            pass
    return True


def set_job_terminal(
    job: GenerationJob,
    status: str,
    error: str | None = None,
    error_code: int | None = None,
) -> None:
    with job.cond:
        if job.cancelled:
            job.status = "stopped"
            job.error = None
            job.error_code = None
        else:
            job.status = status
            job.error = error
            job.error_code = error_code
        job.updated_at = time.time()
        if job.status != "running" and job.completed_at is None:
            job.completed_at = job.updated_at
        job.cond.notify_all()


def run_generation_job(job: GenerationJob, body: dict) -> None:
    # llama-server uses -np 1; serialize background generations accordingly.
    with _generation_lock, local_model_use(str(body.get("model") or DEFAULT_MODEL)):
        conn: http.client.HTTPConnection | None = None
        with job.cond:
            job.upstream_started_at = time.time()
            job.updated_at = job.upstream_started_at
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
                job.http_status = res.status

            if res.status >= 400:
                detail = res.read().decode("utf-8", "replace")
                message = upstream_error_message(detail, res.status)
                log(
                    f"Provider error {job.provider} / {job.resolved_model}: "
                    f"HTTP {res.status} - {message}"
                )
                set_job_terminal(
                    job,
                    "error",
                    message,
                    res.status,
                )
                return

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

                if isinstance(payload, dict):
                    job.update_usage(payload)

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
                        if job.first_token_at is None:
                            job.first_token_at = time.time()
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
        job = GenerationJob(job_id, body)
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
        "huggingface": "HF_TOKEN",
        "nvidia": "NVIDIA_API_KEY",
        "cohere": "COHERE_API_KEY",
        "vercel": "AI_GATEWAY_API_KEY",
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
        if CLOUD_UNLOADS_LOCAL:
            # Libère la RAM du téléphone, sauf si le modèle local est en
            # cours de chargement ou sert encore une autre requête.
            try_unload_model()
        upstream["model"] = str(meta.get("remote_id") or model_id)
        if provider == "cohere" and isinstance(upstream.get("messages"), list):
            upstream["messages"] = [
                {
                    **message,
                    "role": "developer" if message.get("role") == "system" else message.get("role"),
                }
                if isinstance(message, dict) else message
                for message in upstream["messages"]
            ]
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


def resolve_model_id(model_id: str) -> str:
    model_id = MODEL_ALIASES.get(model_id, model_id)
    return DEFAULT_MODEL if model_id == "local" else model_id


@contextmanager
def local_model_use(model_id: str) -> Iterator[None]:
    """Marque le modèle local comme utilisé pendant toute une requête.

    À ouvrir *avant* ensure_model() : le déchargement pour inactivité voit
    ainsi la requête et ne coupe jamais une génération en cours.
    """
    global _model_users, _model_last_used

    if provider_name(resolve_model_id(model_id)) != "local":
        yield
        return

    with _usage_lock:
        _model_users += 1
    try:
        yield
    finally:
        with _usage_lock:
            _model_users -= 1
            _model_last_used = time.monotonic()


def stop_model() -> None:
    with _model_lock:
        _stop_model_locked()


def try_unload_model(min_idle: float = 0) -> bool:
    """Décharge le modèle local s'il est libre, sans jamais attendre.

    Ne fait rien si un chargement tient le verrou, si une requête utilise
    encore le modèle, ou s'il a servi il y a moins de `min_idle` secondes.
    """
    if not _model_lock.acquire(blocking=False):
        return False
    try:
        if _model_proc is None:
            return False
        with _usage_lock:
            busy = _model_users
            idle_for = time.monotonic() - _model_last_used
        if busy or idle_for < min_idle:
            return False
        _stop_model_locked()
        return True
    finally:
        _model_lock.release()


def _stop_model_locked() -> None:
    global _model_proc, _model_log_handle, _active_model

    proc = _model_proc
    _model_proc = None
    _active_model = None

    if proc and proc.poll() is None:
        log("Arrêt du modèle local NPU actif...")
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


def remote_size(url: str) -> int | None:
    """Taille du fichier distant (après redirections), ou None si inconnue."""
    try:
        req = urllib.request.Request(url, method="HEAD")
        with urllib.request.urlopen(req, timeout=20) as res:
            return _integer(res.headers.get("Content-Length"))
    except Exception:
        return None


def check_disk_space(url: str, part_path: Path, label: str) -> None:
    size = remote_size(url)
    if not size:
        return
    resumed = part_path.stat().st_size if part_path.exists() else 0
    needed = max(0, size - resumed) + DISK_MARGIN
    free = shutil.disk_usage(MODEL_DIR).free
    if free < needed:
        gib = 1024 ** 3
        raise RuntimeError(
            f"Espace insuffisant pour {label}: {needed / gib:.1f} GiB nécessaires, "
            f"{free / gib:.1f} GiB libres dans {MODEL_DIR}"
        )


def ensure_model_file(
    meta: dict[str, object],
    keepalive: Callable[[], None] | None = None,
) -> Path:
    filename = str(meta.get("filename") or "").strip()
    url = str(meta.get("url") or "").strip()
    if not filename or not url:
        raise RuntimeError("Configuration de téléchargement du modèle incomplète")

    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    model_path = (MODEL_DIR / filename).resolve()
    if model_path.is_file():
        return model_path

    part_path = Path(str(model_path) + ".part")
    lock_path = Path(str(model_path) + ".lock")
    DOWNLOAD_LOG.parent.mkdir(parents=True, exist_ok=True)
    label = str(meta.get("label") or filename)

    # Verrou inter-processus : le pré-téléchargement lancé par start-ai.sh et
    # un téléchargement à la demande du router n'écrivent jamais en même temps
    # dans le même fichier .part.
    with lock_path.open("a") as lock_file:
        waiting_logged = False
        while True:
            try:
                fcntl.flock(lock_file, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if not waiting_logged:
                    log(f"Téléchargement de {label} déjà en cours, attente...")
                    waiting_logged = True
                if keepalive:
                    keepalive()
                time.sleep(2)

        if model_path.is_file():
            return model_path

        check_disk_space(url, part_path, label)
        log(f"Téléchargement: {label}")

        for attempt in range(1, 21):
            resumed = part_path.stat().st_size if part_path.exists() else 0
            log(
                f"Téléchargement {label}: tentative {attempt}/20"
                + (f", reprise à {resumed / (1024 ** 3):.2f} GiB" if resumed else "")
            )

            args = [
                "curl",
                "-L",
                "--fail",
                "--connect-timeout", "30",
                "--retry", "5",
                "--retry-delay", "5",
                "--retry-all-errors",
                "-C", "-",
                "-o", str(part_path),
                url,
            ]

            with DOWNLOAD_LOG.open("a", encoding="utf-8") as download_log:
                download_log.write(
                    f"\n[{time.strftime('%Y-%m-%d %H:%M:%S')}] {label} tentative {attempt}/20\n"
                )
                download_log.flush()
                proc = subprocess.Popen(
                    args,
                    stdout=download_log,
                    stderr=subprocess.STDOUT,
                )

                last_keepalive = 0.0
                while proc.poll() is None:
                    now = time.monotonic()
                    if keepalive and now - last_keepalive >= 2:
                        keepalive()
                        last_keepalive = now
                    time.sleep(1)

            if proc.returncode == 0:
                part_path.replace(model_path)
                log(f"Téléchargement terminé: {model_path.name}")
                return model_path

            log(f"Téléchargement interrompu pour {label}; reprise dans 5 s")
            for _ in range(5):
                if keepalive:
                    keepalive()
                time.sleep(1)

    raise RuntimeError(
        f"Téléchargement de {label} interrompu après 20 tentatives. "
        f"Le fichier partiel est conservé: {part_path}"
    )


def ensure_model(model_id: str, keepalive: Callable[[], None] | None = None) -> None:
    global _model_proc, _model_log_handle, _active_model, _loading_model
    global _model_last_used

    model_id = resolve_model_id(model_id)
    if model_id not in MODELS:
        raise ValueError(f"Modèle inconnu: {model_id}")

    meta = MODELS[model_id]
    if str(meta.get("provider") or "local") != "local":
        if CLOUD_UNLOADS_LOCAL:
            try_unload_model()
        return

    with _model_lock:
        if (
            _active_model == model_id
            and _model_proc
            and _model_proc.poll() is None
            and model_health()
        ):
            return

        _stop_model_locked()

        if not SNAP_LLAMA_BIN.exists():
            raise RuntimeError(f"llama-server Snapdragon introuvable: {SNAP_LLAMA_BIN}")

        _loading_model = model_id
        try:
            model_path = ensure_model_file(meta, keepalive)
            ubatch = int(meta.get("ubatch") or 1024)

            args = [
                str(SNAP_LLAMA_BIN),
                "-m", str(model_path),
                "-ngl", "99",
                "--device", "HTP0",
                "-fa", "on",
                "--ubatch-size", str(ubatch),
                "--host", MODEL_HOST,
                "--port", str(MODEL_PORT),
                "-c", str(CTX),
                "-np", "1",
            ]
            if THREADS > 0:
                args += ["-t", str(THREADS)]

            model_env = os.environ.copy()
            runtime_lib = str(SNAP_LLAMA_DIR / "lib")
            model_env["LD_LIBRARY_PATH"] = runtime_lib
            model_env["ADSP_LIBRARY_PATH"] = runtime_lib
            model_env["GGML_HEXAGON_DEVICES"] = "HTP0"
            model_env["GGML_HEXAGON_OPPOLL"] = "1"

            MODEL_LOG.parent.mkdir(parents=True, exist_ok=True)
            _model_log_handle = MODEL_LOG.open("w", encoding="utf-8")
            log(f"Chargement NPU: {meta['label']} ({model_path.name})")
            # Référence locale : la boucle ci-dessous ne dépend pas de l'état
            # global, même si un autre fil le consulte pendant le chargement.
            proc = subprocess.Popen(
                args,
                cwd=str(SNAP_LLAMA_DIR),
                env=model_env,
                stdout=_model_log_handle,
                stderr=subprocess.STDOUT,
                start_new_session=True,
            )
            _model_proc = proc
            _active_model = model_id

            started = time.monotonic()
            last_keepalive = 0.0
            while time.monotonic() - started < LOAD_TIMEOUT:
                if proc.poll() is not None:
                    code = proc.returncode
                    _stop_model_locked()
                    raise RuntimeError(
                        f"llama-server NPU s'est arrêté pendant le chargement (code {code}). "
                        f"Voir {MODEL_LOG}"
                    )

                if model_health():
                    with _usage_lock:
                        _model_last_used = time.monotonic()
                    log(f"Modèle NPU prêt: {meta['label']}")
                    return

                now = time.monotonic()
                if keepalive and now - last_keepalive >= 2:
                    keepalive()
                    last_keepalive = now

                time.sleep(1)

            _stop_model_locked()
            raise TimeoutError(f"Chargement du modèle > {LOAD_TIMEOUT}s")
        finally:
            _loading_model = None


def active_model() -> str | None:
    # Lecture sans verrou : ne bloque jamais pendant un chargement.
    proc = _model_proc
    model_id = _active_model
    if model_id and proc and proc.poll() is None and model_id != _loading_model and model_health():
        return model_id
    return None


def idle_unload_loop() -> None:
    while True:
        time.sleep(15)
        if _model_proc is None:
            continue
        label = _active_model
        if try_unload_model(IDLE_UNLOAD):
            log(f"Modèle local déchargé après {IDLE_UNLOAD}s d'inactivité: {label}")


def download_models(target: str) -> int:
    """Pré-télécharge des modèles locaux (utilisé par start-ai.sh)."""
    if target == "all":
        ids = [mid for mid, meta in MODELS.items() if meta.get("provider") == "local"]
    elif target == "default":
        ids = [resolve_model_id(DEFAULT_MODEL)]
    else:
        ids = [resolve_model_id(target)]

    failed = 0
    for model_id in ids:
        meta = MODELS.get(model_id)
        if not meta or meta.get("provider") != "local":
            log(f"Modèle local inconnu: {model_id}")
            failed += 1
            continue
        try:
            path = ensure_model_file(meta)
            log(f"✅ {meta['label']}: {path.name}")
        except Exception as exc:
            log(f"❌ {meta['label']}: {exc}")
            failed += 1
    return 1 if failed else 0


class RouterHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "LueurRouter/1.0"

    def log_message(self, fmt: str, *args) -> None:
        # /health est interrogé toutes les 20 s par l'UI et par la
        # supervision : ne pas en remplir le journal.
        if self.path.startswith("/health") and " 200 " in f" {fmt % args} ":
            return
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
                "loading_model": _loading_model,
                "idle_unload_s": IDLE_UNLOAD,
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
        model_id = MODEL_ALIASES.get(model_id, model_id)
        body["model"] = model_id
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
        with job.cond:
            job.attachments += 1
            job.updated_at = time.time()

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
                    error_code = job.error_code

                    if len(content) <= cursor and status == "running":
                        job.cond.wait(timeout=10)
                        content = job.content
                        status = job.status
                        error = job.error
                        error_code = job.error_code

                if len(content) > cursor:
                    delta = content[cursor:]
                    cursor = len(content)
                    payload = {
                        "choices": [{"delta": {"content": delta}}],
                        "lueur": {
                            "job_id": job.id,
                            "cursor": cursor,
                            "status": status,
                            "metrics": job.metrics_snapshot(),
                        },
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
                        {
                            "error": {
                                "message": error or "Generation failed",
                                "code": error_code or 500,
                            }
                        },
                        ensure_ascii=False,
                    )
                    self.wfile.write(f"data: {payload}\n\n".encode("utf-8"))

                terminal = json.dumps(
                    {
                        "choices": [],
                        "lueur": {
                            "job_id": job.id,
                            "cursor": cursor,
                            "status": status,
                            "metrics": job.metrics_snapshot(),
                        },
                    },
                    ensure_ascii=False,
                )
                self.wfile.write(f"data: {terminal}\n\n".encode("utf-8"))
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
            with local_model_use(model_id):
                conn, res = open_completion(model_id, body, keepalive)
                self._relay_stream(res)
        finally:
            if conn:
                conn.close()

    def _relay_stream(self, res: http.client.HTTPResponse) -> None:
        if res.status >= 400:
            detail = res.read().decode("utf-8", "replace")
            payload = json.dumps(
                {
                    "error": {
                        "message": upstream_error_message(detail, res.status),
                        "code": res.status,
                    }
                },
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

    def _proxy_json(self, body: dict) -> None:
        model_id = str(body.get("model") or DEFAULT_MODEL)
        conn: http.client.HTTPConnection | None = None
        try:
            with local_model_use(model_id):
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
    # Un chargement peut tenir le verrou longtemps : on n'attend pas plus de
    # quelques secondes et on tue directement llama-server si besoin.
    if _model_lock.acquire(timeout=5):
        try:
            _stop_model_locked()
        finally:
            _model_lock.release()
    else:
        proc = _model_proc
        if proc and proc.poll() is None:
            proc.kill()


def main(argv: list[str]) -> int:
    if len(argv) >= 2 and argv[1] == "--download":
        return download_models(argv[2] if len(argv) >= 3 else "default")

    if not SNAP_LLAMA_BIN.exists():
        print(f"❌ llama-server Snapdragon introuvable: {SNAP_LLAMA_BIN}", file=sys.stderr)
        return 1

    MODEL_DIR.mkdir(parents=True, exist_ok=True)

    atexit.register(cleanup)

    def handle_signal(signum, _frame):
        log(f"Signal {signum}, arrêt...")
        cleanup()
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, handle_signal)
    signal.signal(signal.SIGINT, handle_signal)

    server = ThreadingHTTPServer((HOST, PORT), RouterHandler)
    server.daemon_threads = True

    if IDLE_UNLOAD > 0:
        threading.Thread(target=idle_unload_loop, name="lueur-idle-unload", daemon=True).start()

    log(f"Lueur router: http://{HOST}:{PORT}")
    log(f"llama-server interne: http://{MODEL_HOST}:{MODEL_PORT}")
    configured = sum(1 for p in provider_statuses().values() if p["configured"])
    log(f"Modèles: {len(MODELS)} · fournisseurs configurés: {configured}/{len(PROVIDERS)}")
    log("Le local garde un seul modèle GGUF NPU en RAM; les modèles manquants sont téléchargés à la demande.")
    if IDLE_UNLOAD > 0:
        log(f"Déchargement automatique du modèle local après {IDLE_UNLOAD}s d'inactivité.")
    try:
        server.serve_forever(poll_interval=0.5)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        cleanup()
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
