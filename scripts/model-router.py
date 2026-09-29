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
UI_DIR = Path(os.environ.get("LUEUR_UI_DIR", str(Path.home() / "lueur-ui"))).resolve()
LLAMA_DIR = Path(os.environ.get("LUEUR_LLAMA_DIR", str(Path.home() / "llama.cpp"))).resolve()
LLAMA_BIN = LLAMA_DIR / "build" / "bin" / "llama-server"
MODEL_LOG = Path(os.environ.get("LUEUR_MODEL_LOG", str(Path.home() / "llama-model.log")))
DEFAULT_MODEL = "lmstudio-community/Qwen3.5-4B-GGUF:Q4_K_M"

MODELS: dict[str, dict[str, object]] = {
    DEFAULT_MODEL: {"label": "Qwen3.5 4B Vision", "vision": True},
    "ggml-org/gemma-3-4b-it-GGUF:Q4_K_M": {"label": "Gemma 3 4B Vision", "vision": True},
    "bartowski/microsoft_Phi-4-mini-instruct-GGUF:Q4_K_M": {"label": "Phi-4 Mini 3.8B", "vision": False},
    "bartowski/Llama-3.2-3B-Instruct-GGUF:Q4_K_M": {"label": "Llama 3.2 3B", "vision": False},
    "bartowski/HuggingFaceTB_SmolLM3-3B-GGUF:Q4_K_M": {"label": "SmolLM3 3B", "vision": False},
    "bartowski/DeepSeek-R1-Distill-Qwen-1.5B-GGUF:Q4_K_M": {"label": "DeepSeek R1 1.5B", "vision": False},
    "bartowski/Qwen2.5-Coder-3B-Instruct-GGUF:Q4_K_M": {"label": "Qwen2.5 Coder 3B", "vision": False},
}

ALLOWED_ORIGIN = "https://brahmiamine.github.io"
LOAD_TIMEOUT = 1800

_model_lock = threading.RLock()
_model_proc: subprocess.Popen | None = None
_model_log_handle = None
_active_model: str | None = None


def log(message: str) -> None:
    print(time.strftime("[%H:%M:%S]"), message, flush=True)


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

    with _model_lock:
        if _active_model == model_id and _model_proc and _model_proc.poll() is None and model_health():
            return

        stop_model()

        if not LLAMA_BIN.exists():
            raise RuntimeError(f"llama-server introuvable: {LLAMA_BIN}")

        meta = MODELS[model_id]
        args = [
            str(LLAMA_BIN),
            "-hf", model_id,
            "--host", MODEL_HOST,
            "--port", str(MODEL_PORT),
            "-c", str(CTX),
            "-np", "1",
        ]
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
            self._json(200, {"status": "ok", "router": "termux-python", "active_model": active_model()})
            return

        if path == "/models":
            self._json(200, {
                "models": [
                    {"id": mid, "label": meta["label"], "vision": meta["vision"]}
                    for mid, meta in MODELS.items()
                ],
                "active_model": active_model(),
            })
            return

        if path == "/v1/models":
            self._json(200, {
                "object": "list",
                "data": [
                    {"id": mid, "object": "model", "owned_by": "local"}
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
            })
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

        if model_id not in MODELS:
            self._json(400, {"error": {"message": f"Modèle inconnu: {model_id}"}})
            return

        if stream:
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
                ensure_model(model_id, keepalive)
                self._proxy_stream(body)
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
            ensure_model(model_id)
            self._proxy_json(body)
        except ValueError as e:
            self._json(400, {"error": {"message": str(e)}})
        except Exception as e:
            self._json(500, {"error": {"message": str(e)}})

    def _proxy_stream(self, body: dict) -> None:
        conn = http.client.HTTPConnection(MODEL_HOST, MODEL_PORT, timeout=3600)
        try:
            raw = json.dumps(body, ensure_ascii=False).encode("utf-8")
            conn.request(
                "POST",
                "/v1/chat/completions",
                body=raw,
                headers={"Content-Type": "application/json", "Accept": "text/event-stream"},
            )
            res = conn.getresponse()
            if res.status >= 400:
                detail = res.read().decode("utf-8", "replace")
                payload = json.dumps({"error": {"message": detail or f"HTTP {res.status}"}}, ensure_ascii=False)
                self.wfile.write(f"data: {payload}\n\ndata: [DONE]\n\n".encode("utf-8"))
                self.wfile.flush()
                return

            while True:
                chunk = res.read(4096)
                if not chunk:
                    break
                self.wfile.write(chunk)
                self.wfile.flush()
        finally:
            conn.close()

    def _proxy_json(self, body: dict) -> None:
        conn = http.client.HTTPConnection(MODEL_HOST, MODEL_PORT, timeout=3600)
        try:
            raw = json.dumps(body, ensure_ascii=False).encode("utf-8")
            conn.request("POST", "/v1/chat/completions", body=raw, headers={"Content-Type": "application/json"})
            res = conn.getresponse()
            payload = res.read()
            self.send_response(res.status)
            self.send_header("Content-Type", res.getheader("Content-Type", "application/json"))
            self.send_header("Content-Length", str(len(payload)))
            self._cors()
            self.end_headers()
            self.wfile.write(payload)
        finally:
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
    log(f"Modèles: {len(MODELS)} (1 chargé à la fois)")
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
