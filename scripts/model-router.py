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

import ast
import atexit
import fcntl
import hashlib
import http.client
import ipaddress
import json
import math
import mimetypes
import operator
import os
import queue
import re
import shutil
import signal
import socket
import sqlite3
import subprocess
import sys
import threading
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from array import array
from contextlib import contextmanager
from html.parser import HTMLParser
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
# --jinja active les templates de chat qui gèrent le function calling
# (outils de l'agent). LUEUR_JINJA=0 pour un vieux build qui ne le connaît pas.
JINJA = os.environ.get("LUEUR_JINJA", "1") != "0"
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
        # Testé avec llama.cpp --jinja : écrit de faux appels d'outils en texte
        # (« [web_search : …] » en boucle) au lieu de vrais tool_calls.
        "tools": False,
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
        "tools": False,
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
        "tools": False,
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

        requested_model = resolve_model_id(str(body.get("model") or DEFAULT_MODEL))
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
        # Étapes visibles de l'agent (outils, mémoire, résumé), envoyées à l'UI.
        self.steps: list[dict[str, object]] = []
        self.steps_version = 0
        self.has_documents = False

    def add_step(self, step: dict[str, object]) -> int:
        with self.cond:
            self.steps.append(step)
            self.steps_version += 1
            self.updated_at = time.time()
            self.cond.notify_all()
            return len(self.steps) - 1

    def update_step(self, index: int, **fields: object) -> None:
        with self.cond:
            if 0 <= index < len(self.steps):
                self.steps[index].update(fields)
                self.steps_version += 1
                self.updated_at = time.time()
                self.cond.notify_all()

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
                "steps": [dict(s) for s in self.steps],
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
    global _last_generation_end

    model_id = resolve_model_id(str(body.get("model") or DEFAULT_MODEL))
    # llama-server uses -np 1; serialize background generations accordingly.
    with _generation_lock, local_model_use(model_id):
        with job.cond:
            job.upstream_started_at = time.time()
            job.updated_at = job.upstream_started_at
        try:
            if job.cancelled:
                set_job_terminal(job, "stopped")
                return

            base = {k: v for k, v in body.items() if not k.startswith("_lueur_")}
            base["model"] = model_id
            messages = list(base.pop("messages", None) or [])
            conversation_id = str(body.get("_lueur_conversation_id") or "")
            use_memory = bool(body.get("_lueur_memory"))
            agent = bool(body.get("_lueur_agent")) and model_supports_tools(model_id)

            # Liste d'outils provisoire (pour réserver sa place dans le contexte) ;
            # document_search n'est ajouté que si la conversation a des documents.
            tool_names = [
                name for name, spec in TOOLS.items()
                if agent and (spec.get("needs") in (None, "documents")
                              or (use_memory and spec.get("needs") == "memory"))
            ]
            tools_tokens = estimate_tokens(json.dumps([TOOLS[n]["schema"] for n in tool_names])) if agent else 0

            if body.get("_lueur_context"):
                messages = build_context(job, {**body, "model": model_id}, tools_tokens, use_memory)
            if agent:
                tool_names = [n for n in tool_names if n != "document_search" or job.has_documents]
                prompt = agent_system_prompt(tool_names)
                if messages and messages[0].get("role") == "system":
                    messages[0] = {"role": "system", "content": f"{messages[0]['content']}\n\n{prompt}"}
                else:
                    messages.insert(0, {"role": "system", "content": prompt})
                run_agent(job, model_id, base, messages, tool_names, conversation_id)
            else:
                stream_turn(job, model_id, {**base, "messages": messages, "stream": True})

            if job.cancelled:
                set_job_terminal(job, "stopped")
                return
            set_job_terminal(job, "done")

            if use_memory:
                last_user = next((m for m in reversed(body.get("messages") or [])
                                  if isinstance(m, dict) and m.get("role") == "user"), None)
                if last_user:
                    memory_extractor.submit(content_text(last_user.get("content"))[:3000], job.content, model_id)
        except UpstreamHTTPError as exc:
            log(f"Provider error {job.provider} / {job.resolved_model}: HTTP {exc.status} - {exc}")
            set_job_terminal(job, "error", str(exc), exc.status)
        except Exception as exc:
            if job.cancelled:
                set_job_terminal(job, "stopped")
            else:
                log(f"Generation {job.id} error: {exc}")
                set_job_terminal(job, "error", str(exc))
        finally:
            _last_generation_end = time.monotonic()


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
    upstream = {k: v for k, v in body.items() if not k.startswith("_lueur_")}
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
            if JINJA:
                args.append("--jinja")
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
    elif target == "embed":
        ids = []
    else:
        ids = [resolve_model_id(target)]
    if EMBED_ENABLED and target in ("all", "default", "embed"):
        ids.append("embed")

    failed = 0
    for model_id in ids:
        meta = EMBED_MODEL if model_id == "embed" else MODELS.get(model_id)
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


# ---------------------------------------------------------------------------
# Agent : stockage, embeddings, mémoire, contexte, outils, boucle agent.
#
# Tout reste dans ce fichier et n'utilise que la bibliothèque standard
# (numpy est utilisé s'il est installé, sinon Python pur) : start-ai.sh n'a
# qu'un fichier à mettre à jour et rien à compiler sous Termux.
# ---------------------------------------------------------------------------

DATA_DIR = Path(os.environ.get("LUEUR_DATA_DIR", str(Path.home() / ".lueur"))).resolve()
DB_PATH = DATA_DIR / "lueur.db"
# Contexte supposé pour les modèles cloud (le local utilise CTX).
CLOUD_CTX = int(os.environ.get("LUEUR_CLOUD_CTX", "32768"))
AGENT_MAX_STEPS = max(1, int(os.environ.get("LUEUR_AGENT_MAX_STEPS", "6")))
SEARXNG_URL = os.environ.get("LUEUR_SEARXNG_URL", "").strip().rstrip("/")

EMBED_ENABLED = os.environ.get("LUEUR_EMBED", "1") != "0"
EMBED_PORT = int(os.environ.get("LUEUR_EMBED_PORT", "8082"))
EMBED_THREADS = int(os.environ.get("LUEUR_EMBED_THREADS", "2"))
EMBED_LOG = Path(os.environ.get("LUEUR_EMBED_LOG", str(Path.home() / "llama-embed.log")))
EMBED_MODEL: dict[str, object] = {
    "label": "Qwen3 Embedding 0.6B",
    "provider": "local",
    "filename": "Qwen3-Embedding-0.6B-Q8_0.gguf",
    "url": "https://huggingface.co/Qwen/Qwen3-Embedding-0.6B-GGUF/resolve/main/Qwen3-Embedding-0.6B-Q8_0.gguf",
}
# Qwen3-Embedding attend une instruction côté requête, pas côté documents.
EMBED_QUERY_PREFIX = (
    "Instruct: Given a user message, retrieve stored facts or document passages "
    "that help answer it\nQuery: "
)
EMBED_MAX_CHARS = 3000

MEMORY_TOP_K = 5
# En dessous de ce nombre de souvenirs, tous sont injectés (moins cher
# qu'une recherche, et « je m'appelle… » est toujours pertinent).
MEMORY_ALWAYS_ALL = 8
# Calibré avec Qwen3-Embedding sur des souvenirs en français : pertinent ≈ 0.55-0.62,
# hors sujet ≈ 0.25, zone grise ≈ 0.40-0.47 (souvent du bruit : exclue).
SEMANTIC_MIN_SCORE = 0.5
# Reformulation d'un même fait ≈ 0.88 ; faits différents (Tunis/Paris, chat/chien) ≤ 0.80.
DUPLICATE_MIN_SCORE = 0.86
KEYWORD_MIN_SCORE = 0.3
# Une pièce jointe texte plus longue que ça est indexée (RAG) au lieu d'être
# recopiée entièrement dans le prompt.
DOC_MIN_CHARS = 4000
CHUNK_CHARS = 1200
CHUNK_OVERLAP = 150
CHARS_PER_TOKEN = 3.2
USER_AGENT = "Mozilla/5.0 (Linux; Android 14) Lueur/1.0 (+https://github.com/brahmiamine/chat)"

try:  # accélère la recherche vectorielle si numpy est installé
    import numpy as _np
except Exception:  # pragma: no cover - dépend de l'appareil
    _np = None

_last_generation_end = 0.0


def estimate_tokens(content: object) -> int:
    if isinstance(content, str):
        return int(len(content) / CHARS_PER_TOKEN) + 1
    if isinstance(content, list):
        total = 0
        for part in content:
            if isinstance(part, dict):
                if part.get("type") == "text":
                    total += int(len(str(part.get("text") or "")) / CHARS_PER_TOKEN) + 1
                elif part.get("type") == "image_url":
                    total += 800
        return total
    return 0


def content_text(content: object) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n\n".join(
            str(p.get("text") or "") for p in content
            if isinstance(p, dict) and p.get("type") == "text"
        )
    return ""


def strip_think(text: str) -> str:
    return re.sub(r"<think>.*?(</think>|$)", "", text or "", flags=re.S).strip()


def disable_thinking_if_needed(model_id: str, body: dict) -> None:
    if (
        provider_name(model_id) == "local"
        and not THINKING
        and MODELS.get(model_id, {}).get("thinking")
        and "chat_template_kwargs" not in body
    ):
        body["chat_template_kwargs"] = {"enable_thinking": False}


def model_supports_tools(model_id: str) -> bool:
    return bool(MODELS.get(model_id, {}).get("tools", True))


# ---- Stockage SQLite -------------------------------------------------------

_SCHEMA = """
CREATE TABLE IF NOT EXISTS memories (
    id INTEGER PRIMARY KEY,
    text TEXT NOT NULL,
    source TEXT,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL,
    embedding BLOB
);
CREATE TABLE IF NOT EXISTS summaries (
    conversation_id TEXT PRIMARY KEY,
    covered INTEGER NOT NULL,
    summary TEXT NOT NULL,
    updated_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    conversation_id TEXT,
    name TEXT,
    chars INTEGER,
    created_at REAL
);
CREATE TABLE IF NOT EXISTS chunks (
    id INTEGER PRIMARY KEY,
    document_id TEXT NOT NULL,
    idx INTEGER NOT NULL,
    text TEXT NOT NULL,
    embedding BLOB
);
CREATE INDEX IF NOT EXISTS chunks_doc ON chunks(document_id);
CREATE INDEX IF NOT EXISTS documents_conv ON documents(conversation_id);
"""


class Store:
    def __init__(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._db = sqlite3.connect(str(path), check_same_thread=False)
        self._db.row_factory = sqlite3.Row
        with self._lock:
            self._db.execute("PRAGMA journal_mode=WAL")
            self._db.executescript(_SCHEMA)
            self._db.commit()

    def rows(self, sql: str, args: tuple = ()) -> list[sqlite3.Row]:
        with self._lock:
            return self._db.execute(sql, args).fetchall()

    def run(self, sql: str, args: tuple = ()) -> int:
        with self._lock, self._db:
            return int(self._db.execute(sql, args).lastrowid or 0)

    def run_many(self, sql: str, seq: list[tuple]) -> None:
        with self._lock, self._db:
            self._db.executemany(sql, seq)


_store: Store | None = None
_store_lock = threading.Lock()


def store() -> Store:
    global _store
    with _store_lock:
        if _store is None:
            _store = Store(DB_PATH)
        return _store


def pack_vector(vec: list[float]) -> bytes:
    return array("f", vec).tobytes()


def unpack_vector(blob: bytes | None) -> array | None:
    if not blob:
        return None
    vec = array("f")
    vec.frombytes(blob)
    return vec


def _normalize(vec: list[float]) -> list[float]:
    norm = math.sqrt(sum(x * x for x in vec)) or 1.0
    return [x / norm for x in vec]


# ---- Embeddings (second llama-server, CPU) ---------------------------------

class Embedder:
    """Petit llama-server `--embedding` sur CPU, démarré en arrière-plan.

    Tant qu'il n'est pas prêt (téléchargement, chargement), embed() renvoie
    None et la recherche se rabat sur les mots-clés : rien n'attend jamais.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._proc: subprocess.Popen | None = None
        self._log = None
        self._failed_at = 0.0
        self.state = "idle" if EMBED_ENABLED else "off"

    def _url(self, path: str) -> str:
        return f"http://{MODEL_HOST}:{EMBED_PORT}{path}"

    def _healthy(self) -> bool:
        try:
            with urllib.request.urlopen(self._url("/health"), timeout=2) as res:
                return res.status == 200 and b'"ok"' in res.read(256)
        except Exception:
            return False

    def start_async(self) -> None:
        if not EMBED_ENABLED:
            return
        with self._lock:
            if self.state in ("downloading", "starting"):
                return
            if self.state == "ready" and (self._proc is None or self._proc.poll() is None):
                return
            if self.state == "error" and time.monotonic() - self._failed_at < 300:
                return
            self.state = "starting"
        threading.Thread(target=self._start, name="lueur-embed", daemon=True).start()

    def _binary(self) -> tuple[Path, dict[str, str]]:
        env = os.environ.copy()
        custom = os.environ.get("LUEUR_EMBED_BIN", "").strip()
        if custom:
            return Path(custom), env
        # Un build CPU générique évite de toucher au NPU utilisé par le chat.
        for candidate in (LLAMA_DIR / "build" / "bin" / "llama-server", LLAMA_DIR / "llama-server"):
            if candidate.exists():
                return candidate, env
        runtime_lib = str(SNAP_LLAMA_DIR / "lib")
        env["LD_LIBRARY_PATH"] = runtime_lib
        env["ADSP_LIBRARY_PATH"] = runtime_lib
        return SNAP_LLAMA_BIN, env

    def _start(self) -> None:
        try:
            if self._healthy():
                # Serveur d'un router précédent encore vivant : on le réutilise.
                self.state = "ready"
                log("Embeddings: serveur existant réutilisé")
                self._backfill()
                return
            self.state = "downloading"
            model_path = ensure_model_file(EMBED_MODEL)
            self.state = "starting"
            binary, env = self._binary()
            args = [
                str(binary),
                "-m", str(model_path),
                "--embedding",
                "--pooling", "last",
                "-ngl", "0",
                "-c", "2048",
                "-b", "2048",
                "-ub", "2048",
                "-np", "1",
                "-t", str(EMBED_THREADS),
                "--host", MODEL_HOST,
                "--port", str(EMBED_PORT),
            ]
            EMBED_LOG.parent.mkdir(parents=True, exist_ok=True)
            self._log = EMBED_LOG.open("w", encoding="utf-8")
            log(f"Embeddings: démarrage de {EMBED_MODEL['label']} (CPU, port {EMBED_PORT})")
            self._proc = subprocess.Popen(
                args, env=env, stdout=self._log, stderr=subprocess.STDOUT,
                start_new_session=True,
            )
            started = time.monotonic()
            while time.monotonic() - started < 180:
                if self._proc.poll() is not None:
                    raise RuntimeError(f"llama-server embeddings arrêté (code {self._proc.returncode}), voir {EMBED_LOG}")
                if self._healthy():
                    self.state = "ready"
                    log("Embeddings prêts")
                    self._backfill()
                    return
                time.sleep(1)
            raise TimeoutError("Démarrage des embeddings > 180 s")
        except Exception as exc:
            log(f"Embeddings indisponibles ({exc}); recherche par mots-clés en attendant")
            self._failed_at = time.monotonic()
            self.state = "error"
            self.stop()
            self.state = "error"

    def embed(self, texts: list[str], query: bool = False) -> list[list[float]] | None:
        if not texts:
            return []
        if self.state != "ready":
            self.start_async()
            return None
        if self._proc is not None and self._proc.poll() is not None:
            self.state = "idle"
            self.start_async()
            return None
        inputs = [((EMBED_QUERY_PREFIX if query else "") + t)[:EMBED_MAX_CHARS] for t in texts]
        try:
            req = urllib.request.Request(
                self._url("/v1/embeddings"),
                data=json.dumps({"input": inputs}).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=120) as res:
                data = json.loads(res.read().decode("utf-8"))
            items = sorted(data.get("data") or [], key=lambda d: d.get("index", 0))
            vectors = [_normalize([float(x) for x in item["embedding"]]) for item in items]
            return vectors if len(vectors) == len(texts) else None
        except Exception as exc:
            log(f"Embeddings: erreur {exc}")
            return None

    def _backfill(self) -> None:
        """Calcule les vecteurs manquants (souvenirs/documents ajoutés avant)."""
        def work() -> None:
            db = store()
            for table in ("memories", "chunks"):
                while self.state == "ready":
                    rows = db.rows(f"SELECT id, text FROM {table} WHERE embedding IS NULL LIMIT 16")
                    if not rows:
                        break
                    vectors = self.embed([r["text"] for r in rows])
                    if not vectors:
                        return
                    db.run_many(
                        f"UPDATE {table} SET embedding = ? WHERE id = ?",
                        [(pack_vector(v), r["id"]) for v, r in zip(vectors, rows)],
                    )
        threading.Thread(target=work, name="lueur-embed-backfill", daemon=True).start()

    def stop(self) -> None:
        proc = self._proc
        self._proc = None
        if proc and proc.poll() is None:
            try:
                proc.terminate()
                proc.wait(timeout=10)
            except Exception:
                proc.kill()
        if self._log:
            try:
                self._log.close()
            except Exception:
                pass
            self._log = None
        if self.state == "ready":
            self.state = "idle"


embedder = Embedder()


# ---- Recherche hybride (vecteurs + mots-clés) -------------------------------

_STOPWORDS = set(
    "les des une un le la de du et ou en dans sur pour par avec sans est sont que qui quoi "
    "comment pourquoi quel quelle quels quelles vous nous ils elles mon ton son mes tes ses "
    "notre votre leur leurs cette ces cet aux pas plus tres tout tous faire fait peux peut "
    "the and for with that this from what how why are was were you your have has not but".split()
)


def _keywords(text: str) -> set[str]:
    plain = unicodedata.normalize("NFD", (text or "").lower())
    plain = "".join(c for c in plain if not unicodedata.combining(c))
    return {w for w in re.findall(r"[a-z0-9]{3,}", plain) if w not in _STOPWORDS}


def _dot(a: array, b: array) -> float:
    if len(a) != len(b):
        return -1.0
    return float(sum(map(operator.mul, a, b)))


def rank(query: str, items: list[tuple[object, str, bytes | None]], k: int,
         min_semantic: float = SEMANTIC_MIN_SCORE) -> list[tuple[float, object, str]]:
    """Classe (id, texte, vecteur) par pertinence pour `query`."""
    if not items:
        return []
    qvec_list = embedder.embed([query], query=True)
    qvec = array("f", qvec_list[0]) if qvec_list else None
    qwords = _keywords(query)
    scored: list[tuple[float, object, str]] = []

    vectors = [unpack_vector(blob) for _, _, blob in items]
    semantic: list[float | None] = [None] * len(items)
    if qvec is not None:
        if _np is not None:
            idx = [i for i, v in enumerate(vectors) if v is not None and len(v) == len(qvec)]
            if idx:
                mat = _np.array([vectors[i] for i in idx], dtype=_np.float32)
                sims = mat @ _np.array(qvec, dtype=_np.float32)
                for i, s in zip(idx, sims.tolist()):
                    semantic[i] = s
        else:
            for i, v in enumerate(vectors):
                if v is not None:
                    semantic[i] = _dot(v, qvec)

    for i, (item_id, text, _) in enumerate(items):
        if semantic[i] is not None and semantic[i] >= 0:
            if semantic[i] >= min_semantic:
                scored.append((semantic[i], item_id, text))
            continue
        # Pas de vecteur (embeddings pas encore prêts) : mots-clés.
        if qwords:
            words = _keywords(text)
            overlap = len(qwords & words)
            if overlap:
                score = overlap / len(qwords)
                if score >= KEYWORD_MIN_SCORE or overlap >= 2:
                    scored.append((min(0.99, score) * 0.8, item_id, text))
    scored.sort(key=lambda x: x[0], reverse=True)
    return scored[:k]


# ---- Mémoire long terme -----------------------------------------------------

def memory_count() -> int:
    return int(store().rows("SELECT COUNT(*) AS n FROM memories")[0]["n"])


def memory_list() -> list[dict[str, object]]:
    return [
        {"id": r["id"], "text": r["text"], "source": r["source"],
         "created_at": r["created_at"], "updated_at": r["updated_at"]}
        for r in store().rows("SELECT * FROM memories ORDER BY updated_at DESC")
    ]


def memory_search(query: str, k: int = MEMORY_TOP_K, min_semantic: float = SEMANTIC_MIN_SCORE) -> list[dict[str, object]]:
    rows = store().rows("SELECT id, text, embedding FROM memories")
    if len(rows) <= MEMORY_ALWAYS_ALL and min_semantic >= SEMANTIC_MIN_SCORE:
        return [{"id": r["id"], "text": r["text"]} for r in rows]
    ranked = rank(query, [(r["id"], r["text"], r["embedding"]) for r in rows], k, min_semantic)
    return [{"id": item_id, "text": text, "score": round(score, 3)} for score, item_id, text in ranked]


def memory_add(text: str, source: str = "user") -> dict[str, object]:
    text = re.sub(r"\s+", " ", (text or "")).strip()
    if len(text) < 3:
        raise ValueError("Souvenir vide")
    text = text[:500]
    db = store()
    now = time.time()
    norm = " ".join(sorted(_keywords(text)))
    rows = db.rows("SELECT id, text, embedding FROM memories")
    for r in rows:
        if " ".join(sorted(_keywords(r["text"]))) == norm:
            db.run("UPDATE memories SET updated_at = ? WHERE id = ?", (now, r["id"]))
            return {"id": r["id"], "text": r["text"], "status": "exists"}

    vec_list = embedder.embed([text])
    blob = pack_vector(vec_list[0]) if vec_list else None
    if vec_list:
        vec = array("f", vec_list[0])
        for r in rows:
            other = unpack_vector(r["embedding"])
            if other is not None and _dot(vec, other) >= DUPLICATE_MIN_SCORE:
                # Même information reformulée : la plus récente l'emporte.
                db.run(
                    "UPDATE memories SET text = ?, embedding = ?, updated_at = ?, source = ? WHERE id = ?",
                    (text, blob, now, source, r["id"]),
                )
                return {"id": r["id"], "text": text, "status": "updated"}

    mid = db.run(
        "INSERT INTO memories (text, source, created_at, updated_at, embedding) VALUES (?, ?, ?, ?, ?)",
        (text, source, now, now, blob),
    )
    log(f"Souvenir ajouté ({source}): {text[:80]}")
    return {"id": mid, "text": text, "status": "added"}


def memory_delete(memory_id: int) -> bool:
    db = store()
    exists = db.rows("SELECT id FROM memories WHERE id = ?", (memory_id,))
    db.run("DELETE FROM memories WHERE id = ?", (memory_id,))
    return bool(exists)


def memory_clear() -> None:
    store().run("DELETE FROM memories")


def complete(model_id: str, messages: list[dict], max_tokens: int = 400, temperature: float = 0.2) -> str:
    """Appel non streamé, utilisé pour les résumés et l'extraction de souvenirs."""
    body: dict[str, object] = {
        "model": model_id,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": temperature,
        "stream": False,
    }
    disable_thinking_if_needed(model_id, body)
    if provider_name(model_id) == "local":
        body["repeat_penalty"] = 1.15  # les petits modèles bouclent sur un texte répétitif
    conn, res = open_completion(model_id, body)
    try:
        raw = res.read().decode("utf-8", "replace")
        if res.status >= 400:
            raise RuntimeError(upstream_error_message(raw, res.status))
        data = json.loads(raw)
        message = ((data.get("choices") or [{}])[0].get("message") or {})
        return strip_think(str(message.get("content") or ""))
    finally:
        conn.close()


_FIRST_PERSON_RE = re.compile(
    r"(\b(je|j'|j’|mon|ma|mes|moi|nous|notre|nos|i|i'm|my|mine)\b|m'appelle|m’appelle|j'ai|j’ai|j'aime|j’aime)",
    re.I,
)

_EXTRACT_PROMPT = (
    "Tu analyses un échange entre un utilisateur et un assistant. Extrais UNIQUEMENT les "
    "informations durables sur l'utilisateur, utiles dans de futures conversations : identité, "
    "prénom, préférences, projets, matériel, objectifs, décisions. Garde les noms propres exacts "
    "(prénom, nom d'application, modèle d'appareil). Ignore les questions ponctuelles, les "
    "connaissances générales et le contenu de la réponse de l'assistant. Écris chaque information "
    "comme une phrase courte à la troisième personne (ex. « L'utilisateur utilise un Honor Magic7 Pro »). "
    "N'invente rien et ne répète pas les souvenirs déjà connus. Réponds uniquement en JSON : "
    '{"memories": ["..."]} avec au plus 3 éléments, ou {"memories": []} si rien n\'est à retenir.'
)


def parse_json_object(text: str) -> dict:
    start = text.find("{")
    end = text.rfind("}")
    if start < 0 or end <= start:
        return {}
    try:
        data = json.loads(text[start:end + 1])
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


class MemoryExtractor:
    """Extrait des souvenirs après une réponse, quand le modèle est libre."""

    def __init__(self) -> None:
        self._queue: queue.Queue = queue.Queue(maxsize=20)
        self._thread: threading.Thread | None = None

    def submit(self, user_text: str, answer: str, model_id: str) -> None:
        user_text = (user_text or "").strip()
        if len(user_text) < 12 or not _FIRST_PERSON_RE.search(user_text):
            return  # rien de personnel : pas d'appel LLM inutile
        try:
            self._queue.put_nowait((user_text, answer, model_id))
        except queue.Full:
            return
        if self._thread is None or not self._thread.is_alive():
            self._thread = threading.Thread(target=self._run, name="lueur-memory", daemon=True)
            self._thread.start()

    def _run(self) -> None:
        while True:
            try:
                user_text, answer, model_id = self._queue.get(timeout=60)
            except queue.Empty:
                return
            # Laisse passer les messages de l'utilisateur en priorité.
            while _generation_lock.locked() or time.monotonic() - _last_generation_end < 8:
                time.sleep(2)
            try:
                with _generation_lock, local_model_use(model_id):
                    known = memory_search(user_text, k=5)
                    known_text = "\n".join(f"- {m['text']}" for m in known) or "(aucun)"
                    raw = complete(model_id, [
                        {"role": "system", "content": _EXTRACT_PROMPT},
                        {"role": "user", "content": (
                            f"Souvenirs déjà connus :\n{known_text}\n\n"
                            f"Message de l'utilisateur :\n{user_text[:2000]}\n\n"
                            f"Réponse de l'assistant (contexte seulement) :\n{strip_think(answer)[:800]}"
                        )},
                    ], max_tokens=250)
                facts = parse_json_object(raw).get("memories") or []
                for fact in facts[:3]:
                    if isinstance(fact, str) and 5 <= len(fact.strip()) <= 300:
                        memory_add(fact, source="auto")
            except Exception as exc:
                log(f"Extraction de souvenirs impossible: {exc}")


memory_extractor = MemoryExtractor()


# ---- Documents (RAG) --------------------------------------------------------

_DOC_HEADER_RE = re.compile(r"^(?:PDF|Fichier) « (.+?) »")


def chunk_text(text: str) -> list[str]:
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    chunks: list[str] = []
    current = ""
    for para in paragraphs:
        while len(para) > CHUNK_CHARS:
            head, para = para[:CHUNK_CHARS], para[CHUNK_CHARS - CHUNK_OVERLAP:]
            if current:
                chunks.append(current)
                current = ""
            chunks.append(head)
        if len(current) + len(para) + 2 > CHUNK_CHARS and current:
            chunks.append(current)
            current = current[-CHUNK_OVERLAP:] + "\n\n" + para
        else:
            current = f"{current}\n\n{para}" if current else para
    if current:
        chunks.append(current)
    return chunks


def index_document(conversation_id: str, name: str, text: str) -> str:
    doc_id = hashlib.sha1(f"{conversation_id}\0{text}".encode("utf-8")).hexdigest()
    db = store()
    if db.rows("SELECT id FROM documents WHERE id = ?", (doc_id,)):
        return doc_id
    chunks = chunk_text(text)
    db.run(
        "INSERT INTO documents (id, conversation_id, name, chars, created_at) VALUES (?, ?, ?, ?, ?)",
        (doc_id, conversation_id, name, len(text), time.time()),
    )
    # Vecteurs calculés en arrière-plan : l'indexation ne bloque jamais la réponse.
    db.run_many(
        "INSERT INTO chunks (document_id, idx, text, embedding) VALUES (?, ?, ?, NULL)",
        [(doc_id, i, c) for i, c in enumerate(chunks)],
    )
    log(f"Document indexé: {name} ({len(chunks)} extraits)")
    if embedder.state == "ready":
        embedder._backfill()
    else:
        embedder.start_async()
    return doc_id


def conversation_documents(conversation_id: str) -> list[sqlite3.Row]:
    if not conversation_id:
        return []
    return store().rows(
        "SELECT id, name, chars FROM documents WHERE conversation_id = ?", (conversation_id,)
    )


def search_documents(query: str, doc_ids: list[str], k: int = 4) -> list[dict[str, object]]:
    if not doc_ids:
        return []
    marks = ",".join("?" for _ in doc_ids)
    rows = store().rows(
        f"SELECT c.id, c.text, c.embedding, d.name FROM chunks c "
        f"JOIN documents d ON d.id = c.document_id WHERE c.document_id IN ({marks})",
        tuple(doc_ids),
    )
    names = {r["id"]: r["name"] for r in rows}
    ranked = rank(query, [(r["id"], r["text"], r["embedding"]) for r in rows], k, min_semantic=0.2)
    if not ranked and rows:
        # Aucune correspondance : le début du document reste le meilleur indice.
        ranked = [(0.0, r["id"], r["text"]) for r in rows[:2]]
    return [{"name": names.get(item_id, ""), "text": text, "score": round(score, 3)} for score, item_id, text in ranked]


# ---- Outils -----------------------------------------------------------------

class _BlockedUrl(Exception):
    pass


def _check_public_url(url: str) -> None:
    """Refuse les adresses internes : l'agent ne doit pas sonder le téléphone
    (router, llama-server, API ngrok 4040) ni le réseau local."""
    parts = urllib.parse.urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise _BlockedUrl("Seules les URL http(s) publiques sont autorisées")
    try:
        infos = socket.getaddrinfo(parts.hostname, parts.port or (443 if parts.scheme == "https" else 80))
    except socket.gaierror as exc:
        raise _BlockedUrl(f"Nom de domaine introuvable: {parts.hostname}") from exc
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if not ip.is_global:
            raise _BlockedUrl(f"Adresse non publique refusée: {parts.hostname}")


class _SafeRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        _check_public_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


_safe_opener = urllib.request.build_opener(_SafeRedirect())


def http_fetch(url: str, data: bytes | None = None, max_bytes: int = 3_000_000,
               timeout: int = 20) -> tuple[int, str, bytes, str]:
    _check_public_url(url)
    req = urllib.request.Request(url, data=data, headers={
        "User-Agent": USER_AGENT,
        "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
    })
    try:
        with _safe_opener.open(req, timeout=timeout) as res:
            return res.status, res.headers.get("Content-Type", ""), res.read(max_bytes), res.geturl()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.headers.get("Content-Type", ""), exc.read(max_bytes), url


def _decode(raw: bytes, content_type: str) -> str:
    match = re.search(r"charset=([\w-]+)", content_type or "", re.I)
    for enc in ([match.group(1)] if match else []) + ["utf-8", "latin-1"]:
        try:
            return raw.decode(enc)
        except (LookupError, UnicodeDecodeError):
            continue
    return raw.decode("utf-8", "replace")


class _TextExtractor(HTMLParser):
    SKIP = {"script", "style", "noscript", "svg", "nav", "footer", "form", "iframe", "template", "aside"}
    BLOCK = {"p", "div", "br", "li", "h1", "h2", "h3", "h4", "h5", "h6", "tr", "section",
             "article", "pre", "blockquote", "table", "header", "main"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.title = ""
        self._skip = 0
        self._in_title = False

    def handle_starttag(self, tag, attrs):
        if tag in self.SKIP:
            self._skip += 1
        elif tag == "title":
            self._in_title = True
        if tag in self.BLOCK:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in self.SKIP and self._skip:
            self._skip -= 1
        elif tag == "title":
            self._in_title = False
        if tag in self.BLOCK:
            self.parts.append("\n")

    def handle_data(self, data):
        if self._in_title:
            self.title += data
        elif not self._skip:
            self.parts.append(data)

    def text(self) -> str:
        raw = "".join(self.parts)
        lines = [re.sub(r"[ \t ]+", " ", line).strip() for line in raw.splitlines()]
        return re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()


def html_to_text(html: str) -> tuple[str, str]:
    parser = _TextExtractor()
    try:
        parser.feed(html)
        parser.close()
    except Exception:
        pass
    return parser.title.strip(), parser.text()


class _DuckDuckGoParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.results: list[dict[str, str]] = []
        self._field: str | None = None

    def handle_starttag(self, tag, attrs):
        cls = dict(attrs).get("class") or ""
        if tag == "a" and "result__a" in cls.split():
            href = dict(attrs).get("href") or ""
            parsed = urllib.parse.urlsplit(href)
            target = urllib.parse.parse_qs(parsed.query).get("uddg", [href])[0]
            if target.startswith("//"):
                target = "https:" + target
            self.results.append({"title": "", "url": target, "snippet": ""})
            self._field = "title"
        elif "result__snippet" in cls.split() and self.results:
            self._field = "snippet"

    def handle_endtag(self, tag):
        if tag in ("a", "div", "td"):
            self._field = None

    def handle_data(self, data):
        if self._field and self.results:
            self.results[-1][self._field] += data


def _search_searxng(query: str, n: int) -> list[dict[str, str]]:
    url = f"{SEARXNG_URL}/search?" + urllib.parse.urlencode({"q": query, "format": "json"})
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    # Instance choisie par l'utilisateur (souvent dans le réseau local) : pas
    # de filtre d'adresse ici.
    with urllib.request.urlopen(req, timeout=20) as res:
        data = json.loads(res.read().decode("utf-8"))
    return [
        {"title": r.get("title", ""), "url": r.get("url", ""), "snippet": r.get("content", "")}
        for r in (data.get("results") or [])[:n]
    ]


def _search_duckduckgo(query: str, n: int) -> list[dict[str, str]]:
    status, ctype, raw, _ = http_fetch(
        "https://html.duckduckgo.com/html/",
        data=urllib.parse.urlencode({"q": query}).encode("utf-8"),
    )
    html = _decode(raw, ctype)
    if status != 200 or "anomaly" in html[:20000]:
        raise RuntimeError("DuckDuckGo a refusé la requête (anti-robot)")
    parser = _DuckDuckGoParser()
    parser.feed(html)
    results = [r for r in parser.results if r["url"].startswith("http")]
    for r in results:
        r["title"] = r["title"].strip()
        r["snippet"] = re.sub(r"\s+", " ", r["snippet"]).strip()
    return results[:n]


def _search_wikipedia(query: str, n: int) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    for lang in ("fr", "en"):
        url = f"https://{lang}.wikipedia.org/w/api.php?" + urllib.parse.urlencode({
            "action": "query", "list": "search", "srsearch": query,
            "format": "json", "srlimit": n, "utf8": 1,
        })
        status, ctype, raw, _ = http_fetch(url)
        if status != 200:
            continue
        for r in json.loads(_decode(raw, ctype)).get("query", {}).get("search", []):
            title = r.get("title", "")
            out.append({
                "title": f"{title} (Wikipedia {lang})",
                "url": f"https://{lang}.wikipedia.org/wiki/" + urllib.parse.quote(title.replace(" ", "_")),
                "snippet": html_to_text(r.get("snippet", ""))[1],
            })
        if out:
            break
    return out[:n]


def tool_web_search(args: dict, ctx: dict) -> str:
    query = str(args.get("query") or "").strip()
    if not query:
        return "Erreur: requête vide."
    n = max(1, min(8, int(_number(args.get("max_results")) or 5)))
    backends = ([("SearXNG", _search_searxng)] if SEARXNG_URL else []) + [
        ("DuckDuckGo", _search_duckduckgo),
        ("Wikipedia", _search_wikipedia),
    ]
    errors = []
    for name, fn in backends:
        try:
            results = fn(query, n)
        except Exception as exc:
            errors.append(f"{name}: {exc}")
            continue
        if results:
            lines = [f"Résultats ({name}) pour « {query} » :"]
            for i, r in enumerate(results, 1):
                lines.append(f"{i}. {r['title']}\n   {r['url']}\n   {r['snippet'][:300]}")
            return "\n".join(lines)
        errors.append(f"{name}: aucun résultat")
    return "Aucun résultat. " + " ; ".join(errors)


def tool_fetch_url(args: dict, ctx: dict) -> str:
    url = str(args.get("url") or "").strip()
    try:
        status, ctype, raw, final_url = http_fetch(url)
    except _BlockedUrl as exc:
        return f"Erreur: {exc}"
    except Exception as exc:
        return f"Erreur: page inaccessible ({exc})"
    if status >= 400:
        return f"Erreur: HTTP {status} pour {url}"
    text = _decode(raw, ctype)
    title = ""
    if "html" in ctype.lower() or text.lstrip()[:15].lower().startswith(("<!doctype", "<html")):
        title, text = html_to_text(text)
    elif "pdf" in ctype.lower():
        return "Erreur: les PDF distants ne sont pas pris en charge ; demande à l'utilisateur de le joindre."
    limit = int(ctx.get("result_chars") or 4000)
    if len(text) > limit:
        text = text[:limit] + "\n[… page tronquée …]"
    return f"Titre: {title or '(sans titre)'}\nURL: {final_url}\n\n{text}"


def tool_memory_search(args: dict, ctx: dict) -> str:
    found = memory_search(str(args.get("query") or ""), k=8, min_semantic=0.35)
    if not found:
        return "Aucun souvenir correspondant."
    return "\n".join(f"- {m['text']}" for m in found)


def tool_memory_save(args: dict, ctx: dict) -> str:
    try:
        result = memory_add(str(args.get("text") or ""), source="agent")
    except ValueError as exc:
        return f"Erreur: {exc}"
    return {"added": "Souvenir enregistré.", "updated": "Souvenir mis à jour.",
            "exists": "Ce souvenir existait déjà."}[str(result["status"])]


def tool_document_search(args: dict, ctx: dict) -> str:
    docs = conversation_documents(str(ctx.get("conversation_id") or ""))
    found = search_documents(str(args.get("query") or ""), [d["id"] for d in docs], k=4)
    if not found:
        return "Aucun document indexé dans cette conversation."
    return "\n\n".join(f"[« {f['name']} »]\n{f['text']}" for f in found)


_MATH_FUNCS: dict[str, Callable] = {
    name: getattr(math, name) for name in (
        "sqrt", "sin", "cos", "tan", "asin", "acos", "atan", "log", "log10", "log2",
        "exp", "floor", "ceil", "fabs", "hypot", "radians", "degrees",
    )
}
_MATH_FUNCS.update({"abs": abs, "round": round, "min": min, "max": max})
_MATH_CONSTS = {"pi": math.pi, "e": math.e, "tau": math.tau}


def _safe_eval(node: ast.AST) -> float:
    if isinstance(node, ast.Expression):
        return _safe_eval(node.body)
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)) and not isinstance(node.value, bool):
        return node.value
    if isinstance(node, ast.Name) and node.id in _MATH_CONSTS:
        return _MATH_CONSTS[node.id]
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.UAdd, ast.USub)):
        value = _safe_eval(node.operand)
        return value if isinstance(node.op, ast.UAdd) else -value
    if isinstance(node, ast.BinOp):
        left, right = _safe_eval(node.left), _safe_eval(node.right)
        ops = {ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul,
               ast.Div: operator.truediv, ast.FloorDiv: operator.floordiv, ast.Mod: operator.mod}
        if type(node.op) in ops:
            return ops[type(node.op)](left, right)
        if isinstance(node.op, ast.Pow):
            if abs(right) > 1000 or abs(left) > 1e100:
                raise ValueError("Puissance trop grande")
            return left ** right
    if (isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
            and node.func.id in _MATH_FUNCS and not node.keywords and len(node.args) <= 4):
        return _MATH_FUNCS[node.func.id](*[_safe_eval(a) for a in node.args])
    raise ValueError("Expression non autorisée")


def tool_calculator(args: dict, ctx: dict) -> str:
    expr = str(args.get("expression") or "").strip()
    expr = expr.replace("×", "*").replace("÷", "/").replace("^", "**").replace(",", ".")
    if len(expr) > 300:
        return "Erreur: expression trop longue."
    try:
        value = _safe_eval(ast.parse(expr, mode="eval"))
    except ZeroDivisionError:
        return "Erreur: division par zéro."
    except Exception as exc:
        return f"Erreur: {exc}"
    if isinstance(value, float):
        value = float(f"{value:.12g}")  # 399.50000000000006 → 399.5
        if value.is_integer() and abs(value) < 1e15:
            value = int(value)
    return f"{expr} = {value}"


_WEEKDAYS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"]
_MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août",
           "septembre", "octobre", "novembre", "décembre"]


def now_text() -> str:
    t = time.localtime()
    return (f"{_WEEKDAYS[t.tm_wday]} {t.tm_mday} {_MONTHS[t.tm_mon - 1]} {t.tm_year}, "
            f"{t.tm_hour:02d}:{t.tm_min:02d} ({time.strftime('%Z')})")


def tool_current_datetime(args: dict, ctx: dict) -> str:
    return f"Nous sommes le {now_text()}."


def _schema(name: str, description: str, props: dict | None = None, required: list[str] | None = None) -> dict:
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": {"type": "object", "properties": props or {}, "required": required or []},
        },
    }


TOOLS: dict[str, dict[str, object]] = {
    "web_search": {
        "fn": tool_web_search, "label": "Recherche web", "arg": "query",
        "schema": _schema(
            "web_search",
            "Search the web for recent or factual information. Returns titles, URLs and snippets.",
            {"query": {"type": "string"}, "max_results": {"type": "integer"}}, ["query"],
        ),
    },
    "fetch_url": {
        "fn": tool_fetch_url, "label": "Lecture de page", "arg": "url",
        "schema": _schema(
            "fetch_url", "Download a web page and return its readable text.",
            {"url": {"type": "string"}}, ["url"],
        ),
    },
    "memory_search": {
        "fn": tool_memory_search, "label": "Recherche en mémoire", "arg": "query", "needs": "memory",
        "schema": _schema(
            "memory_search", "Search long-term memories about the user.",
            {"query": {"type": "string"}}, ["query"],
        ),
    },
    "memory_save": {
        "fn": tool_memory_save, "label": "Mémorisation", "arg": "text", "needs": "memory",
        "schema": _schema(
            "memory_save",
            "Save a durable fact about the user (preference, project, personal detail) for future conversations.",
            {"text": {"type": "string"}}, ["text"],
        ),
    },
    "document_search": {
        "fn": tool_document_search, "label": "Recherche dans les documents", "arg": "query", "needs": "documents",
        "schema": _schema(
            "document_search", "Search passages inside the documents the user attached to this conversation.",
            {"query": {"type": "string"}}, ["query"],
        ),
    },
    "calculator": {
        "fn": tool_calculator, "label": "Calcul", "arg": "expression",
        "schema": _schema(
            "calculator", "Evaluate a math expression, e.g. 0.15*80 or sqrt(2)*3.",
            {"expression": {"type": "string"}}, ["expression"],
        ),
    },
    "current_datetime": {
        "fn": tool_current_datetime, "label": "Date et heure", "arg": None,
        "schema": _schema("current_datetime", "Current local date and time."),
    },
}


def tool_step_detail(name: str, args: dict) -> str:
    key = (TOOLS.get(name) or {}).get("arg")
    return str(args.get(key) or "")[:200] if key else ""


# ---- Gestionnaire de contexte -----------------------------------------------

_SUMMARY_PROMPT = (
    "Résume les messages suivants d'une conversation. Conserve les faits précis : noms, "
    "chiffres, choix, préférences, décisions, questions en suspens. Puces courtes, en français, "
    "sans préambule, 120 mots maximum."
)
_CONDENSE_PROMPT = (
    "Fusionne ces résumés successifs d'une même conversation en un seul, dans l'ordre, sans "
    "perdre les faits précis (noms, chiffres, choix). Puces courtes, en français, 180 mots maximum."
)


def _unique_lines(text: str) -> str:
    seen: set[frozenset[str]] = set()
    out = []
    for line in text.splitlines():
        key = frozenset(_keywords(line))
        if line.strip() and key and key in seen:
            continue
        seen.add(key)
        out.append(line)
    return "\n".join(out).strip()


def model_context(model_id: str) -> int:
    return CTX if provider_name(model_id) == "local" else CLOUD_CTX


def _clip(content: object, max_tokens: int) -> object:
    max_chars = max(200, int(max_tokens * CHARS_PER_TOKEN))
    marker = "\n\n[… contenu tronqué pour le contexte …]"
    if isinstance(content, str):
        return content if len(content) <= max_chars else content[:max_chars] + marker
    if isinstance(content, list):
        out, left = [], max_chars
        for part in content:
            if isinstance(part, dict) and part.get("type") == "text":
                text = str(part.get("text") or "")
                if left <= 0:
                    continue
                if len(text) > left:
                    text = text[:left] + marker
                left -= len(text)
                out.append({"type": "text", "text": text})
            else:
                out.append(part)
        return out
    return content


def _flatten(content: object) -> object:
    """Contenu uniquement textuel → chaîne (certains fournisseurs refusent les listes)."""
    if isinstance(content, list) and all(isinstance(p, dict) and p.get("type") == "text" for p in content):
        return "\n\n".join(str(p.get("text") or "") for p in content if p.get("text"))
    return content


def conversation_summary(job: "GenerationJob", conversation_id: str, dropped: list[dict], max_tokens: int) -> str:
    db = store()
    row = db.rows("SELECT covered, summary FROM summaries WHERE conversation_id = ?", (conversation_id,))
    covered, summary = (int(row[0]["covered"]), str(row[0]["summary"])) if row else (0, "")
    if covered == len(dropped):
        return summary
    if covered > len(dropped):
        covered, summary = 0, ""  # historique raccourci (régénération) : on repart de zéro

    step = job.add_step({"type": "context", "label": f"Résumé de {len(dropped)} anciens messages", "status": "running"})
    # Par lots, pour que le résumé lui-même tienne dans le contexte du modèle.
    batch_chars = max(2000, int((model_context(job.model_id) - 800) * CHARS_PER_TOKEN * 0.7))
    pending = dropped[covered:]
    # Au plus deux appels, pour ne pas bloquer la réponse une minute : chaque
    # message est d'abord raccourci pour que tout tienne (le début de la
    # conversation compte) ; en dernier recours seulement, les plus vieux sautent.
    per_message = min(1500, max(150, (2 * batch_chars) // max(1, len(pending))))
    while len(pending) > 2 and len(pending) * per_message > 2 * batch_chars:
        pending = pending[1:]
        covered += 1
    # Chaque lot est résumé seul puis les résumés sont mis bout à bout : demander
    # à un petit modèle de « mettre à jour » un résumé lui fait souvent tout
    # réécrire à partir du dernier message.
    parts = [summary] if summary else []
    try:
        while pending:
            lines, used, taken = [], 0, 0
            for m in pending:
                who = "Utilisateur" if m.get("role") == "user" else "Assistant"
                text = strip_think(content_text(m.get("content")))[:per_message]
                if used + len(text) > batch_chars and lines:
                    break
                lines.append(f"{who} : {text}")
                used += len(text)
                taken += 1
            # Consigne répétée après le texte : placée seulement avant, un petit
            # modèle continue la conversation au lieu de la résumer.
            parts.append(_unique_lines(complete(job.model_id, [
                {"role": "system", "content": _SUMMARY_PROMPT},
                {"role": "user", "content": "Messages :\n\n" + "\n\n".join(lines)
                 + "\n\n---\nRésume la conversation ci-dessus en puces courtes (faits précis, noms, choix)."},
            ], max_tokens=max_tokens)))
            covered += taken
            pending = pending[taken:]
            summary = "\n".join(p.strip() for p in parts if p.strip())
            if len(summary) > max_tokens * CHARS_PER_TOKEN:
                summary = _unique_lines(complete(job.model_id, [
                    {"role": "system", "content": _CONDENSE_PROMPT},
                    {"role": "user", "content": summary + "\n\n---\nFusionne ces résumés en un seul, en puces courtes."},
                ], max_tokens=max_tokens))
                parts = [summary]
            db.run(
                "INSERT INTO summaries (conversation_id, covered, summary, updated_at) VALUES (?, ?, ?, ?) "
                "ON CONFLICT(conversation_id) DO UPDATE SET covered = excluded.covered, "
                "summary = excluded.summary, updated_at = excluded.updated_at",
                (conversation_id, covered, summary, time.time()),
            )
        job.update_step(step, status="done")
    except Exception as exc:
        log(f"Résumé impossible: {exc}")
        job.update_step(step, status="error", detail=str(exc)[:200])
    return summary


def _index_attachments(job: "GenerationJob", messages: list[dict], conversation_id: str) -> list[str]:
    """Remplace les longues pièces jointes par un renvoi vers l'index documentaire."""
    doc_ids: list[str] = []
    for m in messages:
        if m.get("role") != "user" or not isinstance(m.get("content"), list):
            continue
        new_parts = []
        for part in m["content"]:
            text = str(part.get("text") or "") if isinstance(part, dict) and part.get("type") == "text" else ""
            header = _DOC_HEADER_RE.match(text) if text else None
            if header and len(text) >= DOC_MIN_CHARS and conversation_id:
                name = header.group(1)
                doc_ids.append(index_document(conversation_id, name, text))
                new_parts.append({"type": "text", "text": (
                    f"[Document « {name} » ({len(text)} caractères) indexé : seuls les extraits "
                    "pertinents sont fournis ; l'outil document_search permet d'en chercher d'autres.]"
                )})
            else:
                new_parts.append(part)
        m["content"] = new_parts
    return doc_ids


def build_context(job: "GenerationJob", body: dict, tools_tokens: int, use_memory: bool) -> list[dict]:
    messages = [dict(m) for m in body.get("messages") or [] if isinstance(m, dict)]
    system_parts: list[str] = []
    if messages and messages[0].get("role") == "system":
        system_parts.append(content_text(messages.pop(0).get("content")))
    conversation_id = str(body.get("_lueur_conversation_id") or "")

    last_user = next((m for m in reversed(messages) if m.get("role") == "user"), None)
    query = ""
    if last_user:
        content = last_user.get("content")
        query = content if isinstance(content, str) else next(
            (str(p.get("text") or "") for p in content or [] if isinstance(p, dict) and p.get("type") == "text"), ""
        )
    query = query[:1000]

    ctx = model_context(job.model_id)
    max_tokens = int(_number(body.get("max_tokens")) or 1024)
    budget = max(1024, ctx - max_tokens - tools_tokens - 64)

    # 1. Documents : indexés, remplacés par leurs extraits pertinents.
    new_docs = _index_attachments(job, messages, conversation_id)
    all_docs = conversation_documents(conversation_id)
    if new_docs and last_user is not None:
        found = search_documents(query or "résumé", [d["id"] for d in all_docs], k=4)
        doc_chars = int(budget * 0.3 * CHARS_PER_TOKEN)
        excerpts, used = [], 0
        for f in found:
            if used + len(f["text"]) > doc_chars:
                break
            excerpts.append(f"[« {f['name']} »]\n{f['text']}")
            used += len(f["text"])
        if excerpts:
            extra = {"type": "text", "text": "Extraits pertinents des documents joints :\n\n" + "\n\n".join(excerpts)}
            content = last_user.get("content")
            last_user["content"] = (content if isinstance(content, list) else [{"type": "text", "text": str(content or "")}]) + [extra]
            job.add_step({"type": "documents", "label": f"{len(excerpts)} extrait(s) de {len(set(new_docs))} document(s) indexé(s)", "status": "done"})
    job.has_documents = bool(all_docs)

    # 2. Images : seules celles du dernier message utilisateur restent.
    for m in messages:
        if m is not last_user and isinstance(m.get("content"), list):
            m["content"] = [
                p if not (isinstance(p, dict) and p.get("type") == "image_url")
                else {"type": "text", "text": "[image d'un message précédent omise]"}
                for p in m["content"]
            ]

    # 3. Mémoire long terme.
    if use_memory:
        memories = memory_search(query) if query else []
        if memories:
            lines, used = [], 0
            for mem in memories:
                used += len(mem["text"])
                if used > budget * 0.15 * CHARS_PER_TOKEN:
                    break
                lines.append(f"- {mem['text']}")
            system_parts.append(
                "Informations mémorisées sur l'utilisateur (à utiliser seulement si c'est pertinent) :\n" + "\n".join(lines)
            )
            job.add_step({"type": "memory", "label": f"{len(lines)} souvenir(s) utilisé(s)",
                          "items": [m["text"] for m in memories[:len(lines)]], "status": "done"})

    system_text = "\n\n".join(p for p in system_parts if p.strip())
    remaining = budget - estimate_tokens(system_text)

    # 4. Messages récents, du plus récent au plus ancien.
    history_tokens = sum(estimate_tokens(m.get("content")) for m in messages)
    summary_tokens = 0
    if history_tokens > remaining and conversation_id:
        summary_tokens = min(350, max(120, remaining // 5))
    available = remaining - summary_tokens
    kept: list[dict] = []
    index = len(messages) - 1
    while index >= 0:
        m = messages[index]
        cost = estimate_tokens(m.get("content"))
        if cost > available:
            if kept:
                break
            m["content"] = _clip(m.get("content"), max(200, available))
            cost = available
        kept.insert(0, m)
        available -= cost
        index -= 1
    dropped = messages[:index + 1]
    # Un historique qui commence par une réponse de l'assistant perturbe certains modèles.
    while kept and kept[0].get("role") == "assistant" and len(kept) > 1:
        dropped.append(kept.pop(0))

    # 5. Résumé glissant de ce qui ne tient plus.
    if dropped and conversation_id:
        summary = conversation_summary(job, conversation_id, dropped, summary_tokens or 300)
        if summary:
            system_text += ("\n\n" if system_text else "") + "Résumé du début de la conversation :\n" + summary

    out = ([{"role": "system", "content": system_text}] if system_text else []) + kept
    for m in out:
        m["content"] = _flatten(m.get("content"))
    return out


# ---- Boucle agent -------------------------------------------------------------

class UpstreamHTTPError(Exception):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status


def _merge_tool_calls(acc: dict[int, dict], deltas: list) -> None:
    for d in deltas:
        if not isinstance(d, dict):
            continue
        fn = d.get("function") or {}
        index = d.get("index")
        if not isinstance(index, int):
            index = len(acc) if (d.get("id") or fn.get("name") or not acc) else max(acc)
        entry = acc.setdefault(index, {"id": "", "type": "function", "function": {"name": "", "arguments": ""}})
        if d.get("id"):
            entry["id"] = str(d["id"])
        if fn.get("name"):
            entry["function"]["name"] += str(fn["name"])
        if fn.get("arguments"):
            args = fn["arguments"]
            entry["function"]["arguments"] += args if isinstance(args, str) else json.dumps(args)


_TEXT_TOOL_CALL_RE = re.compile(r"<tool_call>\s*(\{.*?\})\s*</tool_call>", re.S)


def stream_turn(job: "GenerationJob", model_id: str, request: dict) -> tuple[str, list[dict]]:
    """Un appel modèle streamé : le texte va dans job.content, les appels
    d'outils sont accumulés et renvoyés."""
    conn, res = open_completion(model_id, request)
    try:
        with job.cond:
            job.conn = conn
            job.http_status = res.status
        if res.status >= 400:
            detail = res.read().decode("utf-8", "replace")
            raise UpstreamHTTPError(res.status, upstream_error_message(detail, res.status))

        turn_text = ""
        calls: dict[int, dict] = {}
        finished = False
        while not job.cancelled:
            line = res.readline()
            if not line:
                if job.cancelled or finished:
                    break
                raise RuntimeError("Flux modèle interrompu")
            text = line.decode("utf-8", "replace").strip()
            if not text.startswith("data:"):
                continue
            data = text[5:].strip()
            if data == "[DONE]":
                break
            try:
                payload = json.loads(data)
            except Exception:
                continue
            if not isinstance(payload, dict):
                continue
            job.update_usage(payload)
            if payload.get("error"):
                err = payload["error"]
                raise RuntimeError(str(err.get("message") or err) if isinstance(err, dict) else str(err))
            choices = payload.get("choices") or [{}]
            choice = choices[0] if choices and isinstance(choices[0], dict) else {}
            if choice.get("finish_reason"):
                finished = True
            delta = choice.get("delta") or {}
            if delta.get("tool_calls"):
                _merge_tool_calls(calls, delta["tool_calls"])
            token = delta.get("content")
            if token:
                turn_text += str(token)
                with job.cond:
                    if job.first_token_at is None:
                        job.first_token_at = time.time()
                    job.content += str(token)
                    job.updated_at = time.time()
                    job.cond.notify_all()
            elif delta.get("reasoning_content"):
                with job.cond:
                    job.updated_at = time.time()
                    job.cond.notify_all()
    finally:
        conn.close()
        with job.cond:
            job.conn = None

    tool_calls = [calls[i] for i in sorted(calls) if calls[i]["function"]["name"]]
    if not tool_calls and request.get("tools") and "<tool_call>" in turn_text:
        # Modèle local sans parseur d'outils (llama-server sans --jinja) :
        # on récupère le format texte de Qwen et on l'efface de la réponse.
        for i, match in enumerate(_TEXT_TOOL_CALL_RE.finditer(turn_text)):
            data = parse_json_object(match.group(1))
            if data.get("name"):
                tool_calls.append({"id": f"call_{i}", "type": "function", "function": {
                    "name": str(data["name"]),
                    "arguments": json.dumps(data.get("arguments") or {}, ensure_ascii=False),
                }})
        if tool_calls:
            cleaned = _TEXT_TOOL_CALL_RE.sub("", turn_text)
            with job.cond:
                job.content = job.content[: len(job.content) - len(turn_text)] + cleaned
                job.cond.notify_all()
            turn_text = cleaned
    for i, call in enumerate(tool_calls):
        call["id"] = call["id"] or f"call_{int(time.time() * 1000)}_{i}"
    return turn_text, tool_calls


def _trim_messages(messages: list[dict], budget: int) -> None:
    """Raccourcit les plus anciens résultats d'outils si le contexte déborde."""
    total = sum(estimate_tokens(m.get("content")) for m in messages)
    for m in messages:
        if total <= budget:
            return
        if m.get("role") == "tool" and len(str(m.get("content") or "")) > 400:
            before = estimate_tokens(m["content"])
            m["content"] = str(m["content"])[:300] + "\n[… résultat raccourci pour le contexte …]"
            total -= before - estimate_tokens(m["content"])


def agent_system_prompt(tool_names: list[str]) -> str:
    lines = [f"Tu peux utiliser des outils. Date et heure : {now_text()}."]
    if "web_search" in tool_names:
        lines.append("- Pour une information récente, factuelle ou incertaine, utilise web_search puis, si "
                     "les extraits ne suffisent pas, fetch_url. Cite les URL des sources utilisées.")
    if "memory_save" in tool_names:
        lines.append("- Quand l'utilisateur partage une information durable le concernant, enregistre-la avec memory_save.")
    if "document_search" in tool_names:
        lines.append("- Pour les documents joints, utilise document_search.")
    lines.append("- N'appelle pas d'outil si tu peux répondre directement. Réponds dans la langue de l'utilisateur.")
    return "\n".join(lines)


def run_agent(job: "GenerationJob", model_id: str, base: dict, messages: list[dict],
              tool_names: list[str], conversation_id: str) -> None:
    tools = [TOOLS[n]["schema"] for n in tool_names]
    local = provider_name(model_id) == "local"
    tool_ctx = {"conversation_id": conversation_id, "result_chars": 1800 if local else 6000}
    budget = model_context(model_id) - int(_number(base.get("max_tokens")) or 1024) - 64

    for step_index in range(AGENT_MAX_STEPS):
        if job.cancelled:
            return
        last = step_index == AGENT_MAX_STEPS - 1
        request = {**base, "messages": messages, "stream": True}
        if tools and not last:
            request["tools"] = tools
            request["tool_choice"] = "auto"
        try:
            text, calls = stream_turn(job, model_id, request)
        except UpstreamHTTPError as exc:
            if step_index == 0 and tools and exc.status in (400, 404, 422, 500) and "tool" in str(exc).lower():
                # Modèle ou fournisseur sans function calling : réponse simple.
                job.add_step({"type": "info", "label": "Outils non pris en charge par ce modèle", "status": "done"})
                tools = []
                continue
            raise
        if not calls or job.cancelled:
            return

        messages.append({"role": "assistant", "content": text or None, "tool_calls": calls})
        for call in calls:
            if job.cancelled:
                return
            name = call["function"]["name"]
            args = parse_json_object(call["function"].get("arguments") or "{}")
            spec = TOOLS.get(name)
            step = job.add_step({
                "type": "tool", "name": name,
                "label": str((spec or {}).get("label") or name),
                "detail": tool_step_detail(name, args), "status": "running",
            })
            if not spec or name not in tool_names:
                result = f"Erreur: outil inconnu « {name} »."
            else:
                try:
                    result = str(spec["fn"](args, tool_ctx))
                except Exception as exc:
                    result = f"Erreur: {exc}"
            ok = not result.startswith("Erreur")
            job.update_step(step, status="done" if ok else "error", preview=result[:240])
            limit = int(tool_ctx["result_chars"])
            messages.append({
                "role": "tool", "tool_call_id": call["id"], "name": name,
                "content": result if len(result) <= limit else result[:limit] + "\n[… tronqué …]",
            })
        _trim_messages(messages, budget - len(json.dumps(tools)) // 3)
        if text:
            with job.cond:
                job.content += "\n\n"
                job.cond.notify_all()


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
                "agent": True,
                "tools": list(TOOLS),
                "search": "searxng" if SEARXNG_URL else "duckduckgo+wikipedia",
                "embeddings": embedder.state,
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

        if path == "/lueur/memory":
            try:
                self._json(200, {"memories": memory_list(), "embeddings": embedder.state})
            except Exception as e:
                self._json(500, {"error": {"message": str(e)}})
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

        if path == "/lueur/memory" or path.startswith("/lueur/memory/"):
            self._memory_post(path)
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

    def _memory_post(self, path: str) -> None:
        try:
            if path == "/lueur/memory":
                body = self._read_json()
                self._json(200, memory_add(str(body.get("text") or ""), source="user"))
            elif path == "/lueur/memory/clear":
                memory_clear()
                self._json(200, {"status": "ok"})
            elif path.endswith("/delete"):
                memory_id = int(path[len("/lueur/memory/"):-len("/delete")].strip("/"))
                if memory_delete(memory_id):
                    self._json(200, {"status": "ok", "id": memory_id})
                else:
                    self._json(404, {"error": {"message": "Souvenir introuvable"}})
            else:
                self._json(404, {"error": {"message": "Not found"}})
        except ValueError as e:
            self._json(400, {"error": {"message": str(e)}})
        except Exception as e:
            self._json(500, {"error": {"message": str(e)}})

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

        disable_thinking_if_needed(model_id, body)

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

        sent_steps = -1
        try:
            while True:
                with job.cond:
                    content = job.content
                    status = job.status
                    error = job.error
                    error_code = job.error_code

                    if len(content) <= cursor and status == "running" and job.steps_version == sent_steps:
                        job.cond.wait(timeout=10)
                        content = job.content
                        status = job.status
                        error = job.error
                        error_code = job.error_code
                    steps_version = job.steps_version
                    steps = [dict(st) for st in job.steps] if steps_version != sent_steps else None

                if steps is not None:
                    sent_steps = steps_version
                    if steps or steps_version:
                        raw = json.dumps({"choices": [], "lueur": {"job_id": job.id, "steps": steps}}, ensure_ascii=False)
                        self.wfile.write(f"data: {raw}\n\n".encode("utf-8"))
                        self.wfile.flush()

                if len(content) < cursor:
                    # Texte réécrit côté router (appel d'outil au format texte retiré) :
                    # on renvoie tout et l'UI remplace son contenu.
                    raw = json.dumps({"choices": [], "lueur": {"job_id": job.id, "replace": content, "cursor": len(content)}}, ensure_ascii=False)
                    self.wfile.write(f"data: {raw}\n\n".encode("utf-8"))
                    self.wfile.flush()
                    cursor = len(content)
                    continue

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
    embedder.stop()


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

    store()  # crée la base SQLite dès le démarrage
    embedder.start_async()

    log(f"Lueur router: http://{HOST}:{PORT}")
    log(f"llama-server interne: http://{MODEL_HOST}:{MODEL_PORT}")
    configured = sum(1 for p in provider_statuses().values() if p["configured"])
    log(f"Modèles: {len(MODELS)} · fournisseurs configurés: {configured}/{len(PROVIDERS)}")
    log("Le local garde un seul modèle GGUF NPU en RAM; les modèles manquants sont téléchargés à la demande.")
    log(f"Agent: {len(TOOLS)} outils · recherche {'SearXNG' if SEARXNG_URL else 'DuckDuckGo + Wikipedia'} · mémoire {DB_PATH}")
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
